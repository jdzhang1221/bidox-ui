import type { PageParam, PageResult } from '@vben/request';

import { requestClient } from '#/api/request';

/**
 * AI 模型配置（v2.1）。
 *
 * v2 的三条硬约束（改动前务必先读）：
 * ① **本页只管「对话模型（llm）」** —— embedding / reranker 不在 DB、不在本页，
 *    仍由 AI 服务 `.env` 提供，与租户无关；
 * ② **没有 `tenantId` 字段** —— 租户上下文唯一来源是系统右上角切换器
 *    （→ `visit-tenant-id` 请求头 → `TenantContextHolder`）。页面不显示、不传、不感知；
 * ③ **没有 `capability` 字段** —— 隐式 llm，后端 `CAPABILITY_LLM` 常量写死。
 *
 * v2.1 的变化：**`status` + `isDefault` 合并为单一 `enabled`**。于是
 * ① 列表从「两列三态」变成「一列两态」；② 「启用 A 自动关闭 B」是**一个动作**
 * （后端写 1 时自动把同租户其他行清零）；③ 允许「零启用」（关掉唯一启用的那条不报错）。
 */
export namespace BidAiModelApi {
  /** AI 模型配置 */
  export interface AiModel {
    id?: number;
    /** 租户编号：接口会回传，但页面不展示（由系统切换器决定） */
    tenantId?: number;
    name: string;
    provider: string;
    model: string;
    baseUrl?: string;
    /** 是否已配置密钥（接口永不返回密钥本身） */
    apiKeyConfigured?: boolean;
    temperature?: number;
    timeoutMs?: number;
    extraConfig?: string;
    /**
     * 是否启用：`1` = 本租户当前正在用的对话模型，`0` = 未启用（配置备份）。
     *
     * ⚠️ 极性是 **1 = 启用**，与后端的 `CommonStatusEnum`（`ENABLE = 0`）**相反**。
     * 合并前的 `status` 用的是 `CommonStatusEnum` 极性，迁移时别照抄旧判断。
     */
    enabled: number;
    sort?: number;
    remark?: string;
    createTime?: Date;
  }

  /** 新增/修改入参（含只在提交时出现的明文密钥） */
  export interface AiModelSaveParams extends AiModel {
    /** 修改时留空表示不修改 */
    apiKey?: string;
  }

  /** 测试连接入参 */
  export interface ModelTestParams {
    id?: number;
    provider: string;
    model: string;
    baseUrl?: string;
    apiKey?: string;
    temperature?: number;
    timeoutMs?: number;
  }

  /** 测试连接结果 */
  export interface ModelTestResult {
    ok: boolean;
    latencyMs?: number;
    /** 探测到的向量维度，仅 embedding 有值（本页不再用到，保留以对齐后端 VO） */
    dimension?: number;
    message?: string;
  }

  /**
   * 同步状态（v2 新增，替代 v1 的「推送热生效」按钮）。
   *
   * 自动推送发生在**事务提交之后**，写接口的响应里拿不到结果，
   * 所以保存成功后必须再查一次本接口才知道「到底生效了没有」。
   */
  export interface SyncStatus {
    /** DB 侧配置版本（全表 max(update_time) 的毫秒值） */
    dbVersion?: number;
    /** AI 侧已生效的版本；`null` 表示读不到（AI 服务不可用或从未推送） */
    aiVersion?: null | number;
    /** 是否已同步：`dbVersion === aiVersion` */
    inSync?: boolean;
  }
}

/** 分页查询 AI 模型配置 */
export function getAiModelPage(params: PageParam) {
  return requestClient.get<PageResult<BidAiModelApi.AiModel>>(
    '/bid/ai-model/page',
    { params },
  );
}

/** 查询详情 */
export function getAiModel(id: number) {
  return requestClient.get<BidAiModelApi.AiModel>(`/bid/ai-model/get?id=${id}`);
}

/** 新增 */
export function createAiModel(data: BidAiModelApi.AiModelSaveParams) {
  return requestClient.post<number>('/bid/ai-model/create', data);
}

/** 修改 */
export function updateAiModel(data: BidAiModelApi.AiModelSaveParams) {
  return requestClient.put<boolean>('/bid/ai-model/update', data);
}

/** 删除 */
export function deleteAiModel(id: number) {
  return requestClient.delete<boolean>(`/bid/ai-model/delete?id=${id}`);
}

/** 测试连接 */
export function testAiModel(data: BidAiModelApi.ModelTestParams) {
  return requestClient.post<BidAiModelApi.ModelTestResult>(
    '/bid/ai-model/test',
    data,
  );
}

/**
 * 查询模型配置的同步状态（DB 版本 vs AI 已生效版本）。
 *
 * 只读查询，用的是 `bid:ai-model:query` 权限 —— 能看列表的人就该能看到「生效了没有」。
 */
export function getSyncStatus() {
  return requestClient.get<BidAiModelApi.SyncStatus>(
    '/bid/ai-model/sync-status',
  );
}

/**
 * 推送模型配置到 AI 服务（热生效）。
 *
 * ⚠️ v2 里这个端点**已降级**：正常流程是「保存/删除 → 事务提交后自动推送」，
 * 本端点只剩两个用途：① 自动推送失败后的补救（页面顶部告警里的「立即推送」按钮）；
 * ② 运维手动触发。页面里**没有**常驻的推送按钮。
 */
export function applyAiModel() {
  return requestClient.post<boolean>('/bid/ai-model/apply');
}
