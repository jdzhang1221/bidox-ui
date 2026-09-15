/**
 * SSE 帧解析（§5.5）
 *
 * 刻意**不引入 `@microsoft/fetch-event-source`**，原因有三，每一条都会真实咬人：
 *
 * 1. **它默认自动重连**。本项目的协议要求「断流即终态或 unknown，绝不自动重发 POST」——
 *    重发会用一个已被占用的幂等键再跑一次准入，用户看到的是答案突然从头开始。
 *    库虽然可以通过 `onerror` 抛异常来阻止，但那是「用错的默认值 + 必须记得写对」，
 *    而这里的正确行为是**唯一**的行为。
 * 2. **它的 `onmessage` 是异步派发的**，无法保证「同一个字节块内的后续消息」在 abort 之后
 *    被终态锁忽略 —— 而 §5.10 明确要求这个顺序。
 * 3. 本协议只需要 `event:` / `data:` 两个字段，`id:`（Last-Event-ID）与 `retry:`
 *    都是**明确不支持**的（replay 按 `messageId` 替换快照，不做断点续传）。
 *
 * 于是这里只做最小解析：按 `\n\n` 切帧，逐行识别字段，忽略注释。
 */

/** 一个已解析的 SSE 事件 */
export interface SseFrame {
  /** 事件名。未声明 `event:` 时按 SSE 规范为 `message` */
  event: string;
  /** 事件数据。多行 `data:` 按规范用 `\n` 连接 */
  data: string;
}

/**
 * 解析单帧文本。
 *
 * @returns 无 `data:` 字段时返回 `null`（纯注释帧，例如心跳）
 */
export function parseSseFrame(raw: string): null | SseFrame {
  let event = 'message';
  const dataLines: string[] = [];
  let hasData = false;

  for (const line of raw.split('\n')) {
    if (line === '') {
      continue;
    }
    if (line.startsWith(':')) {
      // 注释帧：本项目用它承载心跳（`:heartbeat`），不进入业务事件序列
      continue;
    }
    const colon = line.indexOf(':');
    // 规范：无冒号时整行是字段名，值为空串
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    // 规范：值以一个前导空格为可选分隔符，只去掉**一个**
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    switch (field) {
      case 'data': {
        hasData = true;
        dataLines.push(value);
        break;
      }
      case 'event': {
        event = value || 'message';
        break;
      }
      default: {
        // `id:` / `retry:` / 未知字段：本项目不支持断点续传，显式忽略而不是静默保留
        break;
      }
    }
  }

  return hasData ? { data: dataLines.join('\n'), event } : null;
}

/**
 * 把 `Response.body` 变成 SSE 帧的异步迭代器。
 *
 * 关键点：**跨 chunk 的残帧必须留在 buffer 里**。`TextDecoder` 以 `{ stream: true }`
 * 增量解码，避免一个 UTF-8 多字节字符被 chunk 边界劈开时变成乱码（中文答案里非常常见）；
 * 帧切分只在完整 `\n\n` 上做，尾部残帧等下一块。
 *
 * 迭代正常结束（上游 EOF）时，会尝试把缓冲区里**没有尾随空行**的最后一帧也交出去 ——
 * 部分代理在流末尾不补 `\n\n`，不处理就会丢掉最后一个 `done`。
 */
export async function* iterateSseFrames(
  response: Response,
): AsyncGenerator<SseFrame> {
  const body = response.body;
  if (!body) {
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      buffer = normalizeNewlines(buffer);
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = parseSseFrame(raw);
        if (frame) {
          yield frame;
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
    // 冲刷解码器，再尝试交付尾部残帧
    buffer += decoder.decode();
    buffer = normalizeNewlines(buffer);
    if (buffer.trim() !== '') {
      const frame = parseSseFrame(buffer);
      if (frame) {
        yield frame;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // 流已关闭 / 已被 abort 时 cancel 会抛，忽略
    }
  }
}

/** SSE 规范允许 `\r\n`、`\r`、`\n` 三种行结束符，统一成 `\n` 才能按 `\n\n` 切帧。 */
function normalizeNewlines(text: string): string {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}
