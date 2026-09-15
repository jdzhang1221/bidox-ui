import type { SseFrame } from '../sse-stream';

import { describe, expect, it } from 'vitest';

import { iterateSseFrames, parseSseFrame } from '../sse-stream';

/**
 * SSE 帧解析回归（§5.5 / §5.10）
 *
 * 这段解析器是**协议正确性的唯一入口**：它错了，后面所有状态机都只是把错误
 * 放大成「答案少了一段」或「一直不结束」。因此覆盖的重点不是「正常情况」，
 * 而是四种真实会遇到、且错了极难排查的边界：
 *
 * 1. **跨 chunk 的残帧** —— TCP 不保证帧对齐，一个 `data:` 行被劈成两半是常态；
 * 2. **UTF-8 多字节字符被劈开** —— 中文答案里几乎必然出现，不增量解码就是乱码；
 * 3. **尾部没有空行的最后一帧** —— 部分代理不补 `\n\n`，处理不当会丢掉 `done`；
 * 4. **注释帧（心跳）** —— 必须被忽略，不能被当成事件推进状态机。
 */

/** 构造一个只有 `body` 的假响应，chunk 顺序即「字节到达顺序」 */
function responseOf(chunks: Uint8Array[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return { body: stream } as unknown as Response;
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function collect(chunks: Uint8Array[]): Promise<SseFrame[]> {
  const frames: SseFrame[] = [];
  for await (const frame of iterateSseFrames(responseOf(chunks))) {
    frames.push(frame);
  }
  return frames;
}

describe('parseSseFrame', () => {
  it('解析 event + data', () => {
    expect(parseSseFrame('event: delta\ndata: {"seq":1}')).toEqual({
      data: '{"seq":1}',
      event: 'delta',
    });
  });

  it('未声明 event 时事件名为 message', () => {
    expect(parseSseFrame('data: hello')).toEqual({
      data: 'hello',
      event: 'message',
    });
  });

  it('多行 data 用换行连接', () => {
    expect(parseSseFrame('data: a\ndata: b\ndata: c')).toEqual({
      data: 'a\nb\nc',
      event: 'message',
    });
  });

  it('值只去掉一个前导空格', () => {
    // 规范规定只去掉一个空格：`data:  x` 的载荷是 ` x`，多去一个就会改写正文
    expect(parseSseFrame('data:  x')?.data).toBe(' x');
  });

  it('忽略注释帧（心跳）', () => {
    expect(parseSseFrame(':heartbeat')).toBeNull();
    expect(parseSseFrame(': heartbeat\n: 另一个注释')).toBeNull();
  });

  it('忽略 id / retry 字段（本期不支持断点续传）', () => {
    expect(parseSseFrame('id: 7\nretry: 3000\ndata: x')).toEqual({
      data: 'x',
      event: 'message',
    });
  });

  it('只有 event 没有 data 时返回 null', () => {
    expect(parseSseFrame('event: done')).toBeNull();
  });
});

describe('iterateSseFrames', () => {
  it('按空行切帧，注释帧不产出事件', async () => {
    const frames = await collect([
      bytes(':heartbeat\n\n'),
      bytes('event: meta\ndata: {"a":1}\n\n'),
      bytes(':heartbeat\n\nevent: done\ndata: {"b":2}\n\n'),
    ]);
    expect(frames).toEqual([
      { data: '{"a":1}', event: 'meta' },
      { data: '{"b":2}', event: 'done' },
    ]);
  });

  it('残帧跨 chunk 保留', async () => {
    const frames = await collect([
      bytes('event: delta\ndata: {"seq"'),
      bytes(':1,"content":"半'),
      bytes('个"}\n\n'),
    ]);
    expect(frames).toEqual([
      { data: '{"seq":1,"content":"半个"}', event: 'delta' },
    ]);
  });

  it('uTF-8 多字节字符被 chunk 边界劈开时不乱码', async () => {
    const payload = 'event: delta\ndata: {"content":"投标保证金"}\n\n';
    const encoded = bytes(payload);
    // 在正中间切：几乎必然落在某个中文字符的 3 字节序列内部
    const cut = Math.floor(encoded.length / 2);
    const frames = await collect([encoded.slice(0, cut), encoded.slice(cut)]);
    expect(frames).toEqual([
      { data: '{"content":"投标保证金"}', event: 'delta' },
    ]);
  });

  it('尾部没有空行的最后一帧也会交付', async () => {
    const frames = await collect([
      bytes(
        'event: delta\ndata: {"seq":1}\n\nevent: done\ndata: {"status":"COMPLETED"}',
      ),
    ]);
    expect(frames).toEqual([
      { data: '{"seq":1}', event: 'delta' },
      { data: '{"status":"COMPLETED"}', event: 'done' },
    ]);
  });

  it(String.raw`兼容 \r\n 行结束符`, async () => {
    const frames = await collect([
      bytes(
        'event: meta\r\ndata: {"a":1}\r\n\r\nevent: done\r\ndata: {"b":2}\r\n\r\n',
      ),
    ]);
    expect(frames).toEqual([
      { data: '{"a":1}', event: 'meta' },
      { data: '{"b":2}', event: 'done' },
    ]);
  });

  it('空 body 不抛异常也不产出事件', async () => {
    const frames = await collect([]);
    expect(frames).toEqual([]);
  });
});
