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
    /** 命中片段文本。**必须按纯文本渲染** */
    snippet?: string;
    /** 产生该 chunk 的确切索引版本（= Java 侧 parse log 编号） */
    indexVersion?: number;
    /** 该索引版本对应的第几次解析。Python 不返回，由 Java 精确回填 */
    attemptNo?: number;
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
