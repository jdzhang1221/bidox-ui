import type { PageParam, PageResult } from '@vben/request';

import { requestClient } from '#/api/request';

/**
 * 企业知识问答（§5.3 / §5.6）
 *
 * 这里**只放非流式接口**。`POST /chat-stream` 是 SSE，必须走原生 `fetch`，
 * 不能经过 `requestClient`：
 *
 * - Axios 的响应拦截器会先尝试把 body 解析成 JSON，SSE 是 `text/event-stream`，
 *   在首个 `data:` 之前 body 一直是空/半包，拦截器要么卡住要么把流读干；
 * - `requestClient` 还会附加 `X-Api-Encrypt` 等只对 JSON 有意义的头。
 *
 * 流式部分见 `#/api/auth-session`（共享认证协调器）与
 * `#/views/bid/knowledge-qa/composables/use-knowledge-qa-stream`（状态机）。
 */
export namespace BidKnowledgeQaApi {
  /** 问答会话 */
  export interface Conversation {
    id?: number;
    title: string;
    /** 首问默认知识库编号；为空表示跨本租户全部知识库 */
    knowledgeBaseId?: number;
    lastMessageId?: number;
    lastMessageTime?: Date;
    createTime?: Date;
  }

  /** assistant 消息状态：0-生成中 1-已完成 2-已失败 3-已取消 */
  export type MessageStatus = 0 | 1 | 2 | 3;

  /** 问答消息 */
  export interface Message {
    id?: number;
    conversationId?: number;
    /** user / assistant */
    role: string;
    status?: MessageStatus;
    clientRequestId?: string;
    replyToMessageId?: number;
    expiresAt?: Date;
    content?: string;
    sources?: Source[];
    errorCode?: string;
    errorMessage?: string;
    finishReason?: string;
    completedTime?: Date;
    createTime?: Date;
  }

  /**
   * 引用来源快照。
   *
   * `similarity` 与 `retrievalScore` 是**两个独立维度**，展示时不要混用：
   * 前者是向量相似度（keyword-only 命中时为 `null`），后者是融合/重排后的排序分。
   * 把排序分当相似度展示，用户看到的 0.94 其实和语义相似度无关。
   */
  export interface Source {
    chunkId?: number;
    sectionId?: number;
    documentId?: number;
    /** 文档展示名。Python 不返回，由 Java 按有效租户回填后成为不可变快照 */
    documentName?: string;
    pageStart?: number;
    pageEnd?: number;
    /** 向量相似度；keyword-only 命中为 null */
    similarity?: number;
    /** 检索排序分（RRF / reranker 输出） */
    retrievalScore?: number;
    /** 排序分类型：vector / keyword / rrf / reranker */
    scoreType?: string;
    /**
     * 产生该 chunk 的确切索引版本（= Java 侧 parse log 编号）
     */
    indexVersion?: number;
    /** 该索引版本对应的第几次解析。Python 不返回，由 Java 精确回填 */
    attemptNo?: number;
    /**
     * ⚠️ 已废弃：正文**不再随 `sources` 事件下发**（2026-09-19）。
     *
     * 它会让 SSE 帧随「条数 × 摘要长度」双向膨胀，迫使服务端把摘要压到 20 字。
     * 现在恒为 `undefined`；正文改由 `getSourceChunks()` 按需拉取。
     * 字段保留仅为兼容历史消息快照（那时存的还是有摘要的版本）。
     */
    snippet?: string;
  }

  /**
   * 按 chunk 编号取回的引用原文。
   *
   * 与 `Source` 的区别：这是**按需拉取的完整正文**（不截断），
   * 而 `Source` 是随流推送的**列表元数据**。
   */
  export interface SourceChunk {
    chunkId?: number;
    documentId?: number;
    sectionId?: number;
    title?: string;
    /** paragraph / table / list / heading / mixed */
    chunkType?: string;
    pageStart?: number;
    pageEnd?: number;
    indexVersion?: number;
    /** 完整正文，展示层自行折叠 */
    content?: string;
  }

  /** 问答知识库选项（只含当前租户启用库的 id/name） */
  export interface KnowledgeBaseOption {
    id: number;
    name: string;
  }

  /** 按 clientRequestId 对账到的请求状态 */
  export interface RequestStatus {
    clientRequestId?: string;
    conversationId?: number;
    userMessageId?: number;
    messageId?: number;
    status?: MessageStatus;
    expiresAt?: Date;
    errorCode?: string;
    errorMessage?: string;
    finishReason?: string;
    completedTime?: Date;
  }
}

/** 分页查询当前用户的问答会话 */
export function getConversationPage(params: PageParam) {
  return requestClient.get<PageResult<BidKnowledgeQaApi.Conversation>>(
    '/bid/knowledge-qa/conversation/page',
    { params },
  );
}

/** 重命名问答会话 */
export function updateConversation(data: { id: number; title: string }) {
  return requestClient.put<boolean>(
    '/bid/knowledge-qa/conversation/update',
    data,
  );
}

/** 删除问答会话（服务端会先收敛活动回答再删除） */
export function deleteConversation(id: number) {
  return requestClient.delete<boolean>(
    `/bid/knowledge-qa/conversation/delete?id=${id}`,
  );
}

/**
 * 按游标加载更早的消息。
 *
 * `beforeMessageId` 为空表示从最新开始；服务端按 `id` 倒序取 `limit` 条，
 * 前端拿到后需**反转**再 prepend，才能保持时间正序。
 */
export function getMessageList(params: {
  beforeMessageId?: number;
  conversationId: number;
  limit?: number;
}) {
  return requestClient.get<BidKnowledgeQaApi.Message[]>(
    '/bid/knowledge-qa/message/list',
    { params },
  );
}

/**
 * 获取当前租户可用于问答的启用知识库。
 *
 * 刻意不复用管理端 `bid:knowledge-base/simple-list`：那个接口要 `bid:knowledge-base:query`，
 * 只拥有问答权限的用户会拿不到下拉数据。
 */
export function getKnowledgeBaseOptions() {
  return requestClient.get<BidKnowledgeQaApi.KnowledgeBaseOption[]>(
    '/bid/knowledge-qa/knowledge-base/options',
  );
}

/**
 * 按 `clientRequestId` 对账问答状态（§5.6）。
 *
 * 停止/断网后不确定终态时用它收敛；**不会**触发 Python 重新生成。
 */
export function getRequestStatus(clientRequestId: string) {
  return requestClient.get<BidKnowledgeQaApi.RequestStatus>(
    '/bid/knowledge-qa/request/status',
    { params: { clientRequestId } },
  );
}

/**
 * 按 chunk 编号批量取引用**原文**（引用面板按需展开）。
 *
 * 为什么正文不在 `sources` 事件里：SSE 单事件上限 64KiB，而正文会让帧大小随
 * 「条数 × 摘要长度」双向膨胀 —— 实测章节扩展到 167 条时，500 字摘要需要 283KB，
 * 只能一路压到 20 字（用户看到的是一句残句，如「随着明珠集团信息化建设的不断深入，因传统」）。
 * 移出帧后只剩元数据（单条约 187B），条数与摘要长度不再互相挤占预算。
 *
 * 返回**不保证顺序、也不保证每个编号都命中**（文档可能在问答之后被删除），
 * 调用方必须按 `chunkId` 回填，不能依赖数组下标。
 */
export function getSourceChunks(chunkIds: number[]) {
  return requestClient.post<BidKnowledgeQaApi.SourceChunk[]>(
    '/bid/knowledge-qa/source/chunk',
    { chunkIds },
  );
}
