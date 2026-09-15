import type { EffectScope } from 'vue';

import { effectScope, watch } from 'vue';

import { isTenantEnable, useAppConfig } from '@vben/hooks';
import { preferences } from '@vben/preferences';
import { useAccessStore, useUserStore } from '@vben/stores';

/**
 * 共享认证会话协调器（§5.10）
 *
 * <p>存在的唯一理由：**SSE 走原生 `fetch`，不经过 Axios 拦截器**。于是 Axios 已有的三件事
 * （注入认证头、401 刷新令牌、错误归一）在流式接口上全部缺失。如果各写一份，两边必然漂移 ——
 * 典型症状是「普通接口正常、问答一开就 401」，且因为流已经开了，错误只能用 SSE `error` 表达，
 * 排查成本极高。
 *
 * <p>本模块提供四件事，全部**只有一份实现**：
 *
 * <ol>
 *   <li>{@link buildAuthHeaders}：每次 attempt **实时**构造纯 `Record<string, string>`。
 *       刻意不返回 `AxiosHeaders`，也不带 `isVisitTenant` / `X-Api-Encrypt` 这类
 *       「只对 Axios 有意义」的伪头 —— 原生 fetch 会把它们原样发给服务端，
 *       其中 `X-Api-Encrypt` 会让后端尝试解密一个明文请求体。</li>
 *   <li>{@link refreshAccessToken}：single-flight 刷新。Axios 拦截器与 SSE 共用同一个 in-flight
 *       Promise，避免「同时开两条流 → 两个并发刷新 → 其中一个用了已被轮换的 refreshToken」。</li>
 *   <li>{@link readCommonResult}：非 SSE 响应**限长**读取（≤64 KiB）并解析 `CommonResult`。
 *       不限长的话，一个误返回的大 body 会把内存读爆；不解析的话，HTTP 200 + `code: 401`
 *       这种「包装过的未登录」会被当成成功。</li>
 *   <li>{@link getSessionSnapshot} / {@link invalidateSession}：会话代次。租户、访问租户、
 *       登录用户任一变化都使旧流立即失效 —— 否则用户切租户后，上一条流仍会把**旧租户**的
 *       答案写进当前会话列表。</li>
 * </ol>
 */

// ======================================================================= //
// 错误
// ======================================================================= //

/**
 * 认证/开流前错误的统一类型。
 *
 * `code` 直接来自后端 `CommonResult.code`（或本模块合成的字符串），
 * 调用方据此决定「刷新重试 / 提示 / 直接失败」，不需要再维护一张映射表。
 */
export class AuthSessionError extends Error {
  /** 是否属于「认证被拒绝」——唯一允许刷新令牌后同 UUID 重发一次的情况 */
  readonly authRejected: boolean;

  readonly code: number | string;

  constructor(
    code: number | string,
    message: string,
    options?: { authRejected?: boolean },
  ) {
    super(message);
    this.name = 'AuthSessionError';
    this.code = code;
    this.authRejected = options?.authRejected ?? code === 401;
  }
}

// ======================================================================= //
// 会话代次
// ======================================================================= //

/** 会话身份快照。只有这四个值都相同，才认为「还是同一个会话」。 */
export interface SessionSnapshot {
  generation: number;
  tenantId: null | number;
  /** 登录用户编号。vben 的 `BasicUserInfo.userId` 是**字符串**，不要按数字比较 */
  userId: null | string;
  visitTenantId: null | number;
}

let sessionGeneration = 0;
const sessionListeners = new Set<() => void>();

/** 当前会话代次。每次身份变化自增。 */
export function getSessionGeneration(): number {
  return sessionGeneration;
}

/**
 * 订阅「会话已切换」。
 *
 * @returns 取消订阅函数
 */
export function onSessionChange(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

/**
 * 让当前会话立即失效：自增代次并同步通知所有订阅者。
 *
 * 订阅者（正在进行的流）应当在回调里**同步** abort 并清 timer，
 * 不要等下一个 tick —— 否则切换后到达的 delta 会被写进新会话的列表。
 */
export function invalidateSession(): void {
  sessionGeneration += 1;
  // 复制一份再遍历：回调里可能会取消订阅
  for (const listener of [...sessionListeners]) {
    try {
      listener();
    } catch {
      // 单个订阅者异常不应影响其它订阅者
    }
  }
}

/** 取当前会话身份快照。 */
export function getSessionSnapshot(): SessionSnapshot {
  const accessStore = useAccessStore();
  const userStore = useUserStore();
  return {
    generation: sessionGeneration,
    tenantId: accessStore.tenantId ?? null,
    visitTenantId: accessStore.visitTenantId ?? null,
    userId: userStore.userInfo?.userId ?? null,
  };
}

/**
 * 快照是否仍然对应当前会话。
 *
 * 流状态机的每个回调都要先过这一关：`onmessage` 可能在 abort 之后才被派发，
 * 只比 `attemptId` 不够（同一会话内重发也会换 attemptId，但那是允许的）。
 */
export function isSessionCurrent(snapshot: SessionSnapshot): boolean {
  const accessStore = useAccessStore();
  const userStore = useUserStore();
  return (
    snapshot.generation === sessionGeneration &&
    snapshot.tenantId === (accessStore.tenantId ?? null) &&
    snapshot.visitTenantId === (accessStore.visitTenantId ?? null) &&
    snapshot.userId === (userStore.userInfo?.userId ?? null)
  );
}

/**
 * 安装会话身份监听（幂等）。
 *
 * 用 `watch` 而不是 `onSessionChange` 的原因：身份变化可能来自**任何**组件
 * （顶栏切租户、退出登录），不一定发生在问答页的 setup 里。
 *
 * **必须放进 detached 的 `effectScope`**：`useKnowledgeQaStream` 是在页面 setup 里调用本函数的，
 * 直接在组件作用域里 `watch` 会被绑定到那个组件实例上 —— 用户一旦离开问答页，
 * watcher 就被停掉，而 `sessionWatcherInstalled` 已经是 true，于是**永远不会重新安装**，
 * 「切租户终止旧流」的保护静默消失。
 */
export function installSessionWatcher(): void {
  if (sessionWatcherScope) {
    return;
  }
  sessionWatcherScope = effectScope(true);
  sessionWatcherScope.run(() => {
    watch(
      () => {
        const accessStore = useAccessStore();
        const userStore = useUserStore();
        return [
          accessStore.tenantId ?? null,
          accessStore.visitTenantId ?? null,
          userStore.userInfo?.userId ?? null,
        ] as const;
      },
      () => {
        invalidateSession();
      },
    );
  });
}

let sessionWatcherScope: EffectScope | null = null;

// ======================================================================= //
// 请求头
// ======================================================================= //

export interface AuthHeaderOptions {
  /**
   * `Accept` 值。SSE 传 `text/event-stream`，JSON 传 `application/json`。
   * 不传则**省略**该头，交给服务端协商。
   */
  accept?: string;
  /**
   * `Content-Type`。无请求体时必须传 `null`/省略 —— 带 body 的 GET 会被某些网关拒绝。
   */
  contentType?: null | string;
  /** 是否携带 `visit-tenant-id`，默认 `true` */
  withVisitTenant?: boolean;
}

/**
 * 构造本次请求的认证头。
 *
 * 约定（§5.10）：**无值即省略**。把 `undefined` 塞进 `Record<string,string>` 会被
 * 序列化成字符串 `"undefined"`，服务端拿到一个非法租户号，报错信息完全不指向这里。
 */
export function buildAuthHeaders(
  options: AuthHeaderOptions = {},
): Record<string, string> {
  const { accept, contentType, withVisitTenant = true } = options;
  const accessStore = useAccessStore();
  const tenantEnable = isTenantEnable();
  const headers: Record<string, string> = {};

  if (accessStore.accessToken) {
    headers.Authorization = `Bearer ${accessStore.accessToken}`;
  }
  if (tenantEnable && accessStore.tenantId !== null) {
    headers['tenant-id'] = String(accessStore.tenantId);
  }
  if (tenantEnable && withVisitTenant && accessStore.visitTenantId !== null) {
    headers['visit-tenant-id'] = String(accessStore.visitTenantId);
  }
  headers['Accept-Language'] = preferences.app.locale;
  if (accept) {
    headers.Accept = accept;
  }
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  return headers;
}

// ======================================================================= //
// single-flight 刷新
// ======================================================================= //

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

/** in-flight 刷新。同一时刻只允许一个刷新请求在飞。 */
let refreshPromise: null | Promise<string> = null;

/**
 * 刷新 accessToken，single-flight。
 *
 * 多个调用方同时进来只会发出**一个** HTTP 请求，全部拿到同一个新 token。
 * 这一点是必须的：后端刷新会轮换 refreshToken，并发刷新时后发的那个会带着
 * 已被轮换掉的旧 refreshToken，直接把用户踢下线。
 *
 * 用原生 `fetch` 而不是 `refreshTokenApi`，是为了避免
 * `request.ts → auth-session.ts → api/core → request.ts` 的循环依赖；
 * 该接口只需要 tenant 头，`buildAuthHeaders` 已经完全覆盖。
 */
export function refreshAccessToken(): Promise<string> {
  if (refreshPromise) {
    return refreshPromise;
  }
  refreshPromise = performRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function performRefresh(): Promise<string> {
  const accessStore = useAccessStore();
  const refreshToken = accessStore.refreshToken;
  if (!refreshToken) {
    throw new AuthSessionError('NO_REFRESH_TOKEN', '登录已过期，请重新登录');
  }
  let response: Response;
  try {
    response = await fetch(
      `${apiURL}/system/auth/refresh-token?refreshToken=${encodeURIComponent(refreshToken)}`,
      {
        headers: buildAuthHeaders({ accept: 'application/json' }),
        method: 'POST',
      },
    );
  } catch {
    throw new AuthSessionError(
      'REFRESH_NETWORK_ERROR',
      '刷新登录状态失败，请检查网络',
      { authRejected: false },
    );
  }
  const result = await readCommonResult(response);
  const newToken = (result?.data as undefined | { accessToken?: string })
    ?.accessToken;
  if (!newToken) {
    // 刷新失败即视为会话终结：清掉本地令牌，避免后续请求继续带着坏 token 打服务端
    accessStore.setAccessToken(null);
    throw new AuthSessionError(
      'REFRESH_REJECTED',
      result?.msg ?? '登录已过期，请重新登录',
    );
  }
  accessStore.setAccessToken(newToken);
  return newToken;
}

// ======================================================================= //
// 限长读取
// ======================================================================= //

/** 非 SSE 响应的读取上限。开流前错误都是短 JSON，超过这个长度一定是异常响应。 */
const MAX_PLAIN_BODY_BYTES = 64 * 1024;

export interface CommonResultBody<T = unknown> {
  code?: number;
  data?: T;
  msg?: string;
}

/**
 * 限长读取响应体并解析成 `CommonResult`。
 *
 * 三个刻意的选择：
 *
 * - **限长**：不信任 `Content-Length`，用 `reader.read()` 累加计数，超过
 *   {@link MAX_PLAIN_BODY_BYTES} 立即停止并返回 `null`；
 * - **不抛异常**：调用方（开流前错误分类）需要「拿不到 body」也能继续判断，
 *   例如 HTTP 401 + 空 body 同样要识别成认证拒绝；
 * - **容错解析**：body 不是 JSON（网关 HTML 错误页）时返回 `null`，由调用方按状态码兜底。
 */
export async function readCommonResult<T = unknown>(
  response: Response,
): Promise<CommonResultBody<T> | null> {
  const text = await readLimitedText(response, MAX_PLAIN_BODY_BYTES);
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as CommonResultBody<T>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** 限长读取为文本。超过上限返回已读部分（调用方不应依赖其可解析）。 */
export async function readLimitedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const body = response.body;
  if (!body) {
    // 无 body 流：退回 text()（此时不可能很大）
    return await response.text();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        chunks.push(value);
        total += value.byteLength;
        if (total >= maxBytes) {
          break;
        }
      }
    }
  } finally {
    // 主动取消：否则连接会一直挂着，占用浏览器连接配额
    try {
      await reader.cancel();
    } catch {
      // 已关闭时 cancel 会抛，忽略
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged.subarray(0, maxBytes));
}

// ======================================================================= //
// 开流
// ======================================================================= //

/** 事件流的内容类型前缀。后端返回可能带 `;charset=UTF-8`，只能前缀匹配。 */
const SSE_CONTENT_TYPE = 'text/event-stream';

/**
 * 开流请求的 `Accept`。**必须是组合值，不能只写 `text/event-stream`**。
 *
 * 只写 `text/event-stream` 会让开流前的错误彻底失真，实测（本地双服务）：
 *
 * <pre>
 * Accept: text/event-stream
 *   缺 clientRequestId → HTTP 400 + {"code":401,"msg":"账号未登录"}   ← 假 401
 * Accept: text/event-stream, application/json
 *   缺 clientRequestId → HTTP 200 + {"code":400,"msg":"请求参数不正确:请求编号不能为空"}
 * </pre>
 *
 * 原因：`@Valid` 失败由 `GlobalExceptionHandler` 返回 `CommonResult`（JSON），
 * 而 Spring MVC 的**响应内容协商**会拿请求的 `Accept` 去筛转换器。
 * 客户端只接受 `text/event-stream` 时没有转换器能写，抛
 * `HttpMediaTypeNotAcceptableException`，请求被转交给容器 `/error` 重新派发 ——
 * 那一次派发丢掉了安全上下文，最终由认证入口返回「账号未登录」。
 *
 * 危害不止是文案错：那个假的 `code: 401` 会被本模块判成「认证被拒绝」，
 * 于是为一次**永远不可能成功**的参数校验失败去刷新令牌并重发一次。
 *
 * 加上 `application/json` 后，错误分支有转换器可用，`SseEmitter` 分支仍然正常
 * （`SseEmitter` 自己会把响应类型设成 `text/event-stream`，与协商结果无关）。
 */
const SSE_ACCEPT = 'text/event-stream, application/json';

export interface OpenSseOptions {
  /** 请求体。`attemptId` 由本函数注入，调用方不要自己放。 */
  body: Record<string, unknown>;
  /** 本次尝试编号（调用方生成，用于日志串联与旧 attempt 失效） */
  attemptId: string;
  /** 中止信号 */
  signal: AbortSignal;
  /** 请求路径，默认 `/bid/knowledge-qa/chat-stream` */
  url?: string;
}

export interface OpenSseResult {
  /** 已确认是 event-stream 的响应 */
  response: Response;
  /** 实际使用的 attemptId。认证重试时会是**新**的那个 */
  attemptId: string;
}

/**
 * 打开 SSE 连接，内置「认证拒绝 → 刷新 → 同 UUID 重发一次」。
 *
 * 重发的边界必须严格（§5.4）：只有**认证被拒绝**（`code === 401`）才允许重发。
 * 业务级错误（403 权限、400 参数、幂等冲突、容量）一律直接抛 —— 它们的幂等键
 * 已经和那组参数绑定了，重发只会再拿到同一个终态，还会让服务端多跑一次准入。
 *
 * 重发**换 `attemptId`**（那是「一次 HTTP 尝试」的身份），`clientRequestId` 保持不变
 * （那是「业务请求身份」，认证重试/对账/replay 都必须复用）。
 * 调用方必须使用返回的 `attemptId` 做后续的「旧 attempt 失效」判断，
 * 否则重发后到达的事件会被误判成旧 attempt 而丢弃。
 */
export async function openSse(options: OpenSseOptions): Promise<OpenSseResult> {
  let attemptId = options.attemptId;
  const first = await sendOnce({ ...options, attemptId });
  if (first.ok) {
    return { attemptId, response: first.response };
  }
  if (!first.error.authRejected) {
    throw first.error;
  }
  // 认证拒绝：刷新令牌后重发一次。刷新失败会抛 AuthSessionError，交由调用方展示
  await refreshAccessToken();
  attemptId = createUuid();
  const second = await sendOnce({ ...options, attemptId });
  if (second.ok) {
    return { attemptId, response: second.response };
  }
  throw second.error;
}

type SendOutcome =
  | { error: AuthSessionError; ok: false }
  | { ok: true; response: Response };

async function sendOnce(options: OpenSseOptions): Promise<SendOutcome> {
  const {
    body,
    attemptId,
    signal,
    url = '/bid/knowledge-qa/chat-stream',
  } = options;
  let response: Response;
  try {
    response = await fetch(`${apiURL}${url}`, {
      body: JSON.stringify({ ...body, attemptId }),
      headers: buildAuthHeaders({
        accept: SSE_ACCEPT,
        contentType: 'application/json',
      }),
      method: 'POST',
      signal,
    });
  } catch (error) {
    // abort 是正常控制流（用户停止/切会话），不能报成网络错误
    if (isAbortError(error)) {
      throw error;
    }
    throw new AuthSessionError(
      'NETWORK_ERROR',
      '无法连接问答服务，请检查网络',
      { authRejected: false },
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (response.ok && contentType.includes(SSE_CONTENT_TYPE)) {
    return { ok: true, response };
  }

  // 走到这里说明不是 SSE：要么 HTTP 非 2xx，要么 HTTP 200 但返回了 CommonResult
  const result = await readCommonResult(response);
  const code = result?.code ?? response.status;
  const message =
    result?.msg ??
    (response.ok
      ? '问答服务返回了非流式响应'
      : `请求失败（HTTP ${response.status}）`);
  return {
    error: new AuthSessionError(code, message, { authRejected: code === 401 }),
    ok: false,
  };
}

/** 判断是否为 abort 引发的异常。`AbortSignal` 的 reason 形态在不同环境不一致，两种都要认。 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError'
  );
}

// ======================================================================= //
// 杂项
// ======================================================================= //

/** 生成 UUID v4。优先用平台实现，缺失时退化为「时间戳 + 随机」。 */
export function createUuid(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  // 兜底：非安全上下文（如 http 访问非 localhost）下 randomUUID 不可用。
  // 这里只需要「极低碰撞概率」，不要求密码学强度。
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replaceAll(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
