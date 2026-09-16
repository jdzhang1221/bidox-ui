import type { Ref } from 'vue';

import type { SseFrame } from './sse-stream';

import type { SessionSnapshot } from '#/api/auth-session';
import type { BidKnowledgeQaApi } from '#/api/bid/knowledge-qa';

import { onScopeDispose, readonly, ref } from 'vue';

import {
  AuthSessionError,
  createUuid,
  getSessionSnapshot,
  installSessionWatcher,
  isAbortError,
  isSessionCurrent,
  onSessionChange,
  openSse,
} from '#/api/auth-session';
import { getRequestStatus } from '#/api/bid/knowledge-qa';

import { iterateSseFrames } from './sse-stream';

/**
 * 知识问答流状态机（§5.10）
 *
 * <p>这个 composable 是「一次 SSE attempt」的全部生命周期，页面只负责渲染。
 * 之所以要这么重，是因为流式问答的失败模式全都集中在**时序**上，而时序问题
 * 一旦散落在组件里就无法审计：
 *
 * <ul>
 *   <li><b>旧 attempt 覆盖新终态</b>：用户停止后立刻重问，上一条流的 `done` 迟到，
 *       把新会话的消息标成完成。这里用「attempt 对象身份 + 终态锁」双重拦截。</li>
 *   <li><b>切租户后旧答案写进新列表</b>：`isSessionCurrent` 比对会话代次，
 *       不匹配就直接丢弃。</li>
 *   <li><b>EOF 当成功</b>：断网时流正常结束但没有 `done`。这里落到 `unknown` 并
 *       用 `/request/status` 有界对账，**绝不**自动重发 POST。</li>
 *   <li><b>每个 delta 触发一次渲染</b>：76 个 delta 就是 76 次 patch。正文进非响应式
 *       缓冲，每 {@link FLUSH_INTERVAL_MS} 合并一次。</li>
 * </ul>
 */

// ======================================================================= //
// 类型
// ======================================================================= //

/** 一次 attempt 的相位 */
export type QaAttemptPhase =
  | 'completed'
  | 'connecting'
  | 'failed'
  | 'generating'
  | 'stopped'
  | 'unknown';

/**
 * 页面相位。
 *
 * `idle` 是协议里没写、但实现必须有的一个值：它表示「本次会话还没有发生过 attempt」。
 * 没有它就只能把初始值设成某个终态，而任何终态都会让页面在开屏瞬间显示
 * 「已完成」或「失败」这种错误信息。
 */
export type QaStreamPhase = 'idle' | QaAttemptPhase;

/** `event: meta` 载荷 */
export interface QaMetaPayload {
  attemptId: string;
  clientRequestId: string;
  conversationId: number;
  messageId: number;
  mode: 'live' | 'replay';
  requestId: string;
  userMessageId: number;
}

/** `event: delta` 载荷 */
export interface QaDeltaPayload {
  attemptId: string;
  clientRequestId: string;
  content: string;
  messageId: number;
  requestId: string;
  seq: number;
}

/** 终态描述 */
export interface QaTerminal {
  errorCode?: string;
  errorMessage?: string;
  finishReason?: string;
  messageId?: null | number;
  phase: QaAttemptPhase;
  status?: 'CANCELLED' | 'COMPLETED' | 'FAILED';
}

export interface QaStreamHandlers {
  /**
   * 合并后的正文。`content` 是**从流开始到现在的全文**，不是增量 ——
   * 页面直接覆盖即可，不需要自己拼接（拼接逻辑只能有一份，否则重放/合并时必然错位）。
   */
  onContent?: (content: string, messageId: null | number) => void;
  onMeta?: (meta: QaMetaPayload) => void;
  /**
   * 对账结果。`phase` 会同步更新；页面据此修正消息状态。
   *
   * 第二个参数是 `clientRequestId`，**页面必须用它定位消息**而不是「当前那条」：
   * 对账是异步的（最长 {@link RECONCILE_WINDOW_MS}），期间用户完全可能已经问了下一个问题。
   */
  onReconciled?: (
    status: BidKnowledgeQaApi.RequestStatus,
    clientRequestId: string,
  ) => void;
  onSources?: (
    sources: BidKnowledgeQaApi.Source[],
    messageId: null | number,
  ) => void;
  onTerminal?: (terminal: QaTerminal) => void;
}

export interface QaStartInput {
  clientRequestId?: string;
  conversationId?: null | number;
  knowledgeBaseId?: null | number;
  question: string;
}

export interface UseKnowledgeQaStreamOptions extends QaStreamHandlers {
  /**
   * 页面侧的上下文校验：当前 attempt 是否仍属于「用户正在看的那条会话」。
   *
   * 会话身份不能只靠 `conversationId` 比对 —— 新会话在 `meta` 到达前是 `null`，
   * 而用户此时可能已经点了「新对话」。页面最清楚自己的当前上下文，所以由它回答。
   */
  isContextCurrent?: () => boolean;
}

// ======================================================================= //
// 常量
// ======================================================================= //

/** 正文合并窗口。75ms ≈ 13 次/秒，肉眼完全跟得上，同时把渲染次数压到 delta 数的 1/10 以下 */
const FLUSH_INTERVAL_MS = 75;

/** 对账轮询间隔 */
const RECONCILE_INTERVAL_MS = 1200;

/**
 * 对账窗口。
 *
 * 必须有界：`GENERATING` 的助手行最长会活到绝对 deadline（分钟级），
 * 无界轮询会让「停止」按钮看起来永远转不完。窗口结束后如实显示 `unknown`。
 */
const RECONCILE_WINDOW_MS = 15_000;

// ======================================================================= //
// 实现
// ======================================================================= //

interface ActiveAttempt {
  attemptId: string;
  clientRequestId: string;
  conversationId: null | number;
  controller: AbortController;
  /** 已接受的最大 delta seq，用于去重与丢包检测 */
  lastSeq: number;
  /** 终态锁。置位后所有后续事件（含同一字节块里的）一律忽略 */
  locked: boolean;
  messageId: null | number;
  session: SessionSnapshot;
}

export function useKnowledgeQaStream(options: UseKnowledgeQaStreamOptions) {
  const phase = ref<QaStreamPhase>('idle');
  const activeClientRequestId = ref<null | string>(null);
  const activeMessageId = ref<null | number>(null);

  let activeAttempt: ActiveAttempt | null = null;
  /** 正文缓冲。刻意**不是** `ref` —— 它每几毫秒就变一次，进响应式系统等于自己制造渲染风暴 */
  let buffer = '';
  /** 已交付给页面的长度，避免重复回调同一个值 */
  let emittedLength = 0;
  let flushTimer: null | ReturnType<typeof setTimeout> = null;

  installSessionWatcher();
  // 租户/访问租户/登录用户任一变化：立刻让旧流失效，否则旧租户的答案会写进新租户的列表
  const unsubscribeSession = onSessionChange(() => invalidate());

  onScopeDispose(() => {
    unsubscribeSession();
    invalidate();
  });

  /**
   * 让当前 attempt 失效并中止。
   *
   * **不发终态**：这是「被打断」而不是「有结论」。卸载、切会话、切租户都走这里，
   * 页面会在下一次挂载时从服务端重新拉消息，那里的状态才是权威。
   */
  function invalidate(): void {
    const attempt = activeAttempt;
    activeAttempt = null;
    clearFlushTimer();
    buffer = '';
    emittedLength = 0;
    if (attempt) {
      try {
        attempt.controller.abort();
      } catch {
        // 已中止时 abort 不抛，但保险起见包一层
      }
    }
  }

  function isCurrent(attempt: ActiveAttempt): boolean {
    return (
      activeAttempt === attempt &&
      !attempt.controller.signal.aborted &&
      isSessionCurrent(attempt.session) &&
      (options.isContextCurrent?.() ?? true)
    );
  }

  /**
   * 启动一次流式问答。
   *
   * 调用前会先作废旧 attempt。`clientRequestId` 若未提供则新生成 ——
   * 幂等重试（对账后重发）必须由调用方**显式传入同一个值**。
   */
  async function start(input: QaStartInput): Promise<void> {
    invalidate();

    const clientRequestId = input.clientRequestId ?? createUuid();
    const controller = new AbortController();
    const attempt: ActiveAttempt = {
      attemptId: createUuid(),
      clientRequestId,
      conversationId: input.conversationId ?? null,
      controller,
      lastSeq: 0,
      locked: false,
      messageId: null,
      session: getSessionSnapshot(),
    };
    activeAttempt = attempt;
    buffer = '';
    emittedLength = 0;
    activeClientRequestId.value = clientRequestId;
    activeMessageId.value = null;
    phase.value = 'connecting';

    try {
      const { response, attemptId } = await openSse({
        attemptId: attempt.attemptId,
        body: {
          clientRequestId,
          conversationId: input.conversationId ?? null,
          knowledgeBaseId: input.knowledgeBaseId ?? null,
          question: input.question,
        },
        signal: controller.signal,
      });
      if (!isCurrent(attempt)) {
        // 开流期间用户已经切走：把连接还回去，不要留着占用浏览器连接配额
        await response.body?.cancel().catch(() => {});
        return;
      }
      // 认证重试可能换了 attemptId（新的一次 HTTP 尝试），必须同步过来
      attempt.attemptId = attemptId;

      for await (const frame of iterateSseFrames(response)) {
        if (attempt.locked || !isCurrent(attempt)) {
          return;
        }
        handleFrame(attempt, frame);
      }

      // EOF 且没有合法终态：网络断开/中间代理截断。落 unknown 并对账，**不重发 POST**
      if (isCurrent(attempt) && !attempt.locked) {
        lockTerminal(attempt, { phase: 'unknown' });
        void reconcile(clientRequestId);
      }
    } catch (error) {
      if (isAbortError(error)) {
        // 主动停止 / 切会话 / 卸载：终态由 stop()/invalidate() 负责，这里不是失败
        return;
      }
      if (!isCurrent(attempt)) {
        return;
      }
      lockTerminal(attempt, {
        errorCode:
          error instanceof AuthSessionError ? String(error.code) : 'UNKNOWN',
        errorMessage:
          error instanceof Error ? error.message : '问答请求失败，请稍后重试',
        phase: 'failed',
      });
    }
  }

  /** 用户主动停止。先落 `stopped`，再用 `/request/status` 有界确认服务端终态。 */
  function stop(): void {
    const attempt = activeAttempt;
    if (!attempt) {
      return;
    }
    lockTerminal(attempt, { phase: 'stopped' });
    void reconcile(attempt.clientRequestId);
  }

  /**
   * 按 `clientRequestId` 对账（§5.6）。
   *
   * 只在「本地不确定」时调用：用户停止、EOF 无终态、协议错误。
   * 对账**不会**启动 Python，也不会重发 POST。
   */
  async function reconcile(clientRequestId: string): Promise<void> {
    const deadline = Date.now() + RECONCILE_WINDOW_MS;
    for (;;) {
      let status: BidKnowledgeQaApi.RequestStatus | null = null;
      try {
        status = await getRequestStatus(clientRequestId);
      } catch {
        // 对账请求自身失败（网络抖动、权限）：不改判定，继续下一轮或超时
      }
      if (status) {
        options.onReconciled?.(status, clientRequestId);
        const terminalPhase = phaseOfStatus(status.status);
        if (terminalPhase) {
          // 只有「对账的仍是最新一次请求」时才改相位。
          // 期间用户可能已经问了下一个问题，那时相位属于新 attempt，不能被旧对账覆盖。
          if (activeClientRequestId.value === clientRequestId) {
            phase.value = terminalPhase;
          }
          return;
        }
      }
      if (Date.now() >= deadline) {
        if (activeClientRequestId.value === clientRequestId) {
          phase.value = 'unknown';
        }
        return;
      }
      await delay(RECONCILE_INTERVAL_MS);
    }
  }

  // --------------------------------------------------------------------- //
  // 事件处理
  // --------------------------------------------------------------------- //

  function handleFrame(attempt: ActiveAttempt, frame: SseFrame): void {
    const payload = parsePayload(attempt, frame);
    if (payload === null) {
      return;
    }
    // 载荷回显的业务身份必须与当前 attempt 一致。
    // 理论上 `isCurrent` 已经覆盖，这里是「同一个字节块里混入旧 attempt 事件」的兜底。
    if (
      typeof payload.clientRequestId === 'string' &&
      payload.clientRequestId !== attempt.clientRequestId
    ) {
      return;
    }
    if (
      typeof payload.attemptId === 'string' &&
      payload.attemptId !== attempt.attemptId
    ) {
      return;
    }

    switch (frame.event) {
      case 'delta': {
        handleDelta(attempt, payload as unknown as QaDeltaPayload);
        break;
      }
      case 'done': {
        const done = payload as unknown as {
          finishReason?: string;
          messageId?: number;
          status?: string;
        };
        flushNow();
        lockTerminal(attempt, {
          finishReason: done.finishReason,
          messageId: done.messageId ?? attempt.messageId,
          phase: 'completed',
          status: 'COMPLETED',
        });
        break;
      }
      case 'error': {
        const error = payload as unknown as {
          code?: string;
          message?: string;
          messageId?: number;
        };
        flushNow();
        // `CANCELLED` 是**正常**终态（用户停止 / 会话被删除），不是失败。
        // 后端刻意用同一个 `error` 事件承载它，前端必须按 code 分流。
        const cancelled = error.code === 'CANCELLED';
        lockTerminal(attempt, {
          errorCode: error.code,
          errorMessage: error.message,
          messageId: error.messageId ?? attempt.messageId,
          phase: cancelled ? 'stopped' : 'failed',
          status: cancelled ? 'CANCELLED' : 'FAILED',
        });
        break;
      }
      case 'meta': {
        const meta = payload as unknown as QaMetaPayload;
        attempt.conversationId = meta.conversationId;
        attempt.messageId = meta.messageId;
        activeMessageId.value = meta.messageId;
        phase.value = 'generating';
        options.onMeta?.(meta);
        break;
      }
      case 'sources': {
        const sources =
          (payload.sources as BidKnowledgeQaApi.Source[] | undefined) ?? [];
        options.onSources?.(sources, attempt.messageId);
        break;
      }
      default: {
        // 未知事件名：前向兼容，忽略即可。真正的协议错误由 parsePayload 负责
        break;
      }
    }
  }

  function handleDelta(attempt: ActiveAttempt, delta: QaDeltaPayload): void {
    const seq = Number(delta.seq);
    if (!Number.isInteger(seq) || seq < 1) {
      failProtocol(attempt, 'delta.seq 不是正整数');
      return;
    }
    if (seq <= attempt.lastSeq) {
      // 重复或乱序：静默丢弃。丢弃是幂等的，接受则会重复一段正文
      return;
    }
    if (seq > attempt.lastSeq + 1) {
      // 有缺口：继续拼会得到一段**看起来通顺但缺内容**的答案，比直接失败更危险
      failProtocol(
        attempt,
        `delta 序号出现缺口（期望 ${attempt.lastSeq + 1}，收到 ${seq}）`,
      );
      return;
    }
    attempt.lastSeq = seq;
    buffer += delta.content ?? '';
    scheduleFlush(attempt);
  }

  /**
   * 校验并解析事件载荷。
   *
   * 空 `data` 先过滤（SSE 允许只有注释的帧）；JSON 解析或形状校验失败一律进协议错误，
   * **不做兜底猜测** —— 猜错的代价是把协议问题伪装成「答案就是这么短」。
   */
  function parsePayload(
    attempt: ActiveAttempt,
    frame: SseFrame,
  ): null | Record<string, unknown> {
    if (frame.data.trim() === '') {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame.data);
    } catch {
      failProtocol(attempt, `事件 ${frame.event} 的 data 不是合法 JSON`);
      return null;
    }
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      failProtocol(attempt, `事件 ${frame.event} 的 data 不是对象`);
      return null;
    }
    return parsed as Record<string, unknown>;
  }

  function failProtocol(attempt: ActiveAttempt, message: string): void {
    flushNow();
    lockTerminal(attempt, {
      errorCode: 'PROTOCOL_ERROR',
      errorMessage: message,
      phase: 'failed',
    });
  }

  // --------------------------------------------------------------------- //
  // 正文缓冲
  // --------------------------------------------------------------------- //

  function scheduleFlush(attempt: ActiveAttempt): void {
    if (flushTimer !== null) {
      return;
    }
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (!isCurrent(attempt)) {
        return;
      }
      emitBuffer(attempt);
    }, FLUSH_INTERVAL_MS);
  }

  /** 立即交付缓冲（终态路径用）。 */
  function flushNow(): void {
    clearFlushTimer();
    emitBuffer(activeAttempt);
  }

  function emitBuffer(attempt: ActiveAttempt | null): void {
    if (buffer.length === emittedLength) {
      return;
    }
    emittedLength = buffer.length;
    options.onContent?.(buffer, attempt?.messageId ?? null);
  }

  function clearFlushTimer(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  // --------------------------------------------------------------------- //
  // 终态
  // --------------------------------------------------------------------- //

  /**
   * 锁定终态。**先到者赢**，后续调用全部无操作。
   *
   * 顺序是刻意的（§5.10）：锁终态 → flush 正文 → 清 timer → abort。
   * 反过来的话，flush 里触发的渲染可能读到已经变成 `null` 的 `activeAttempt`。
   */
  function lockTerminal(attempt: ActiveAttempt, terminal: QaTerminal): void {
    if (attempt.locked) {
      return;
    }
    attempt.locked = true;
    flushNow();
    clearFlushTimer();
    phase.value = terminal.phase;
    if (activeAttempt === attempt) {
      activeAttempt = null;
    }
    options.onTerminal?.(terminal);
    try {
      attempt.controller.abort();
    } catch {
      // 忽略：abort 本身不应让终态处理失败
    }
  }

  return {
    /** 当前 attempt 的业务身份，用于对账/重发 */
    activeClientRequestId: readonly(activeClientRequestId) as Ref<
      null | string
    >,
    /** 当前 assistant 消息编号（`meta` 到达后才有值） */
    activeMessageId: readonly(activeMessageId) as Ref<null | number>,
    /** 使旧 attempt 失效（卸载 / 切会话 / KeepAlive deactivated） */
    invalidate,
    /** 页面相位 */
    phase: readonly(phase) as Ref<QaStreamPhase>,
    /** 对账（通常由 stop / unknown 自动触发，也可手动调用） */
    reconcile,
    /** 启动一次流式问答 */
    start,
    /** 用户主动停止 */
    stop,
  };
}

// ======================================================================= //
// 辅助
// ======================================================================= //

/** 把持久化状态映射成相位。`GENERATING` 返回 `null`，表示「还没到终态」。 */
function phaseOfStatus(
  status: BidKnowledgeQaApi.MessageStatus | undefined,
): null | QaAttemptPhase {
  switch (status) {
    case 1: {
      return 'completed';
    }
    case 2: {
      return 'failed';
    }
    case 3: {
      return 'stopped';
    }
    default: {
      // 0 = GENERATING，或字段缺失：都还不能下结论
      return null;
    }
  }
}

function delay(millis: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, millis);
  });
}
