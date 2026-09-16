import type { AxiosRequestConfig, PageParam, PageResult } from '@vben/request';

import { requestClient } from '#/api/request';

/** Axios 上传进度事件 */
export type AxiosProgressEvent = AxiosRequestConfig['onUploadProgress'];

export namespace BidDocumentApi {
  /** 文档信息 */
  export interface Document {
    id?: number;
    knowledgeBaseId: number;
    fileId?: number;
    displayName: string;
    /** 文档类型（historical_bid / tender） */
    documentType: string;
    /** 生命周期（ACTIVE / DELETING / DELETED） */
    lifecycleStatus?: string;
    /**
     * 最近一次解析状态。
     *
     * 这是**前端合成字段**：由文档列表接口附带的解析日志（`bid_document_parse_log`）
     * 推导而来，后端不返回同名字段，所以是可选的。
     */
    _parseStatus?: ParseStatus;
    createTime?: Date;
  }

  /** 解析状态：0-等待中 1-解析中 2-成功 3-失败 4-已中断 */
  export type ParseStatus = 0 | 1 | 2 | 3 | 4;

  /** 解析日志 */
  export interface ParseLog {
    id?: number;
    documentId: number;
    /** 第几次解析 */
    attemptNo: number;
    status: ParseStatus;
    parser?: string;
    parserVersion?: string;
    blockCount?: number;
    sectionCount?: number;
    chunkCount?: number;
    patternCount?: number;
    errorCode?: string;
    errorMessage?: string;
    beginTime?: Date;
    endTime?: Date;
    /** 解析耗时（毫秒） */
    duration?: number;
  }

  /** 文档上传参数 */
  export interface DocumentUploadReqVO {
    file: globalThis.File;
    knowledgeBaseId: number;
    displayName: string;
    documentType: string;
  }
}

/** 查询文档分页列表 */
export function getDocumentPage(params: PageParam) {
  return requestClient.get<PageResult<BidDocumentApi.Document>>(
    '/bid/document/page',
    { params },
  );
}

/** 查询文档详情 */
export function getDocument(id: number) {
  return requestClient.get<BidDocumentApi.Document>(
    `/bid/document/get?id=${id}`,
  );
}

/** 上传文档（仅上传登记，不自动解析） */
export function uploadDocument(
  data: BidDocumentApi.DocumentUploadReqVO,
  onUploadProgress?: AxiosProgressEvent,
) {
  return requestClient.upload<number>('/bid/document/upload', data, {
    onUploadProgress,
  });
}

/** 删除文档 */
export function deleteDocument(id: number) {
  return requestClient.delete<boolean>(`/bid/document/delete?id=${id}`);
}

/** 手动触发文档解析，返回解析日志编号 */
export function triggerDocumentParse(documentId: number) {
  return requestClient.post<number>('/bid/document/parse', { documentId });
}

/** 查询某个文档的全部解析日志（按 attemptNo 倒序） */
export function getDocumentParseLogList(documentId: number) {
  return requestClient.get<BidDocumentApi.ParseLog[]>(
    `/bid/document/parse-log/list?documentId=${documentId}`,
  );
}

/** 批量查询多个文档的最新解析日志 */
export function getLatestParseLogList(documentIds: number[]) {
  return requestClient.post<BidDocumentApi.ParseLog[]>(
    '/bid/document/parse-log/latest-list',
    { documentIds },
  );
}
