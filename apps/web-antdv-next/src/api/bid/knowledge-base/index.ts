import type { PageParam, PageResult } from '@vben/request';

import { requestClient } from '#/api/request';

export namespace BidKnowledgeBaseApi {
  /** 知识库信息 */
  export interface KnowledgeBase {
    id?: number;
    name: string;
    description?: string;
    /** 状态（0-启用 1-停用） */
    status: number;
    createTime?: Date;
  }
}

/** 查询知识库分页列表 */
export function getKnowledgeBasePage(params: PageParam) {
  return requestClient.get<PageResult<BidKnowledgeBaseApi.KnowledgeBase>>(
    '/bid/knowledge-base/page',
    { params },
  );
}

/** 查询知识库详情 */
export function getKnowledgeBase(id: number) {
  return requestClient.get<BidKnowledgeBaseApi.KnowledgeBase>(
    `/bid/knowledge-base/get?id=${id}`,
  );
}

/** 查询知识库精简列表（下拉选择用） */
export function getKnowledgeBaseSimpleList() {
  return requestClient.get<BidKnowledgeBaseApi.KnowledgeBase[]>(
    '/bid/knowledge-base/simple-list',
  );
}

/** 新增知识库 */
export function createKnowledgeBase(data: BidKnowledgeBaseApi.KnowledgeBase) {
  return requestClient.post<number>('/bid/knowledge-base/create', data);
}

/** 修改知识库 */
export function updateKnowledgeBase(data: BidKnowledgeBaseApi.KnowledgeBase) {
  return requestClient.put<boolean>('/bid/knowledge-base/update', data);
}

/** 删除知识库 */
export function deleteKnowledgeBase(id: number) {
  return requestClient.delete<boolean>(`/bid/knowledge-base/delete?id=${id}`);
}
