import type { BidKnowledgeQaApi } from '#/api/bid/knowledge-qa';

/**
 * 会话内的一条消息（页面模型）
 *
 * <p>为什么不直接用 `BidKnowledgeQaApi.Message`：流式问答里消息有**两种来源**，
 * 它们的字段完整度不同，混在一起会让每个使用点都要判空。
 *
 * <ul>
 *   <li>历史消息：来自 `message/list`，`id` 一定有值；</li>
 *   <li>本地消息：用户刚发出、或刚占位的助手回答，**服务端编号还没有**
 *       （要等 `meta` 事件），但必须立刻渲染出来。</li>
 * </ul>
 *
 * <p>`key` 因此与 `id` 分离：`key` 由前端生成且**永不变**，用作 `v-for` 的 key、
 * 滚动锚点标识、以及「找到那条正在流式写入的消息」的依据。用 `id` 当 key 的话，
 * `meta` 到达时 id 从 `null` 变成真实编号，整个节点会被销毁重建 —— 正在播放的
 * 动画会闪、滚动位置会跳。
 */
export interface ChatMessage {
  content: string;
  errorCode?: string;
  errorMessage?: string;
  finishReason?: string;
  /** 服务端消息编号。本地占位消息为 `null`，`meta` 到达后回填 */
  id: null | number;
  /** 本地唯一键，永不变 */
  key: string;
  /**
   * 思考链（模型的 reasoning），**仅本次流式期间展示用**。
   *
   * 它不落库、也不随历史消息回来 —— 所以从 `message/list` 载入的历史消息永远是空的。
   * 与 `content` 严格分离：`content` 是答案正文（带 `[来源N]` 引用），两者绝不能拼接，
   * 否则引用编号会错位。
   */
  reasoning?: string;
  /** user / assistant */
  role: string;
  sources?: BidKnowledgeQaApi.Source[];
  /** 0-生成中 1-已完成 2-已失败 3-已取消 */
  status?: BidKnowledgeQaApi.MessageStatus;
}

/** 生成一个本地消息键 */
export function createMessageKey(): string {
  messageKeySeq += 1;
  return `local-${messageKeySeq}`;
}

let messageKeySeq = 0;

/** 把服务端消息转换成页面模型 */
export function toChatMessage(message: BidKnowledgeQaApi.Message): ChatMessage {
  return {
    content: message.content ?? '',
    errorCode: message.errorCode,
    errorMessage: message.errorMessage,
    finishReason: message.finishReason,
    id: message.id ?? null,
    key:
      message.id === undefined || message.id === null
        ? createMessageKey()
        : `server-${message.id}`,
    role: message.role,
    sources: message.sources ?? [],
    status: message.status,
  };
}
