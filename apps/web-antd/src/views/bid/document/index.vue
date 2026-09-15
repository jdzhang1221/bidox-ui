<script lang="ts" setup>
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { BidDocumentApi } from '#/api/bid/document';

import { onUnmounted, ref } from 'vue';

import { Page, useVbenDrawer, useVbenModal } from '@vben/common-ui';

import { message, Tag } from 'ant-design-vue';

import { ACTION_ICON, TableAction, useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  deleteDocument,
  getDocumentPage,
  getLatestParseLogList,
  triggerDocumentParse,
} from '#/api/bid/document';
import { getKnowledgeBaseSimpleList } from '#/api/bid/knowledge-base';
import { $t } from '#/locales';

import {
  parseStatusTagType,
  parseStatusText,
  useGridColumns,
  useGridFormSchema,
} from './data';
import ParseLogDrawer from './modules/parse-log-drawer.vue';
import UploadModal from './modules/upload-modal.vue';

// ==================== 弹窗 / 抽屉 ====================

const [UploadModalComp, uploadModalApi] = useVbenModal({
  connectedComponent: UploadModal,
  destroyOnClose: true,
});

const [ParseLogDrawerComp, parseLogDrawerApi] = useVbenDrawer({
  connectedComponent: ParseLogDrawer,
});

// ==================== 知识库名称映射 ====================

const knowledgeBaseMap = ref<Map<number, string>>(new Map());

async function loadKnowledgeBaseMap() {
  try {
    const list = await getKnowledgeBaseSimpleList();
    const map = new Map<number, string>();
    list.forEach((item) => {
      if (item.id !== undefined && item.id !== null) {
        map.set(item.id, item.name);
      }
    });
    knowledgeBaseMap.value = map;
  } catch {
    // 忽略
  }
}

loadKnowledgeBaseMap();

// ==================== 解析状态轮询 ====================

/** 最新解析日志映射：documentId → ParseLog */
const latestLogMap = ref<Map<number, BidDocumentApi.ParseLog>>(new Map());

/** 轮询定时器 */
let pollTimer: null | ReturnType<typeof setInterval> = null;

/** 当前页文档列表 */
const currentPageDocs = ref<BidDocumentApi.Document[]>([]);

/** 加载当前页文档的最新解析日志 */
async function loadLatestParseLogs(docs: BidDocumentApi.Document[]) {
  if (docs.length === 0) {
    latestLogMap.value = new Map();
    return;
  }
  const ids = docs
    .map((d) => d.id)
    .filter((id): id is number => id !== undefined && id !== null);
  if (ids.length === 0) return;
  try {
    const logs = await getLatestParseLogList(ids);
    const map = new Map<number, BidDocumentApi.ParseLog>();
    logs.forEach((log) => {
      if (log.documentId) {
        map.set(log.documentId, log);
      }
    });
    latestLogMap.value = map;
  } catch {
    // 忽略
  }
}

/** 是否有文档正在解析中（需要轮询） */
function hasActiveParse(): boolean {
  for (const log of latestLogMap.value.values()) {
    if (log.status === 0 || log.status === 1) {
      return true;
    }
  }
  return false;
}

/** 启动轮询 */
function startPollingIfNeeded() {
  if (!hasActiveParse()) {
    stopPolling();
    return;
  }
  if (pollTimer) return; // 已在轮询
  pollTimer = setInterval(async () => {
    if (currentPageDocs.value.length === 0) return;
    await loadLatestParseLogs(currentPageDocs.value);
    if (!hasActiveParse()) {
      stopPolling();
      // 轮询结束后刷新一次完整数据
      gridApi.query();
    }
  }, 3000);
}

/** 停止轮询 */
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

onUnmounted(() => stopPolling());

// ==================== 事件处理 ====================

/** 刷新 */
function handleRefresh() {
  gridApi.query();
}

/** 上传文档 */
function handleUpload() {
  uploadModalApi.open();
}

/** 上传成功后刷新 */
function handleUploadSuccess() {
  handleRefresh();
}

/** 触发解析 */
async function handleParse(row: BidDocumentApi.Document) {
  if (!row.id) return;
  const hide = message.loading({
    content: '正在触发解析...',
    duration: 0,
  });
  try {
    await triggerDocumentParse(row.id);
    message.success('解析任务已提交，请等待解析完成');
    // 立即刷新一次，然后启动轮询
    await gridApi.query();
    startPollingIfNeeded();
  } catch {
    // 错误已由全局拦截器处理
  } finally {
    hide();
  }
}

/** 查看解析日志 */
function handleViewParseLog(row: BidDocumentApi.Document) {
  parseLogDrawerApi
    .setData({ id: row.id, displayName: row.displayName })
    .open();
}

/** 删除文档 */
async function handleDelete(row: BidDocumentApi.Document) {
  if (!row.id) return;
  const hide = message.loading({
    content: $t('ui.actionMessage.deleting', [row.displayName]),
    duration: 0,
  });
  try {
    await deleteDocument(row.id);
    message.success($t('ui.actionMessage.deleteSuccess', [row.displayName]));
    handleRefresh();
  } finally {
    hide();
  }
}

// ==================== 列表 Grid ====================

const [Grid, gridApi] = useVbenVxeGrid({
  formOptions: {
    schema: useGridFormSchema(),
  },
  gridOptions: {
    columns: useGridColumns(),
    height: 'auto',
    keepSource: true,
    pagerConfig: {
      enabled: true,
    },
    proxyConfig: {
      enabled: true,
      ajax: {
        query: async ({ page }, formValues) => {
          const res = await getDocumentPage({
            pageNo: page.currentPage,
            pageSize: page.pageSize,
            ...formValues,
          });
          // 保存当前页文档列表
          currentPageDocs.value = res.list ?? [];
          // 合并知识库名称
          const list = (res.list ?? []).map((doc) => ({
            ...doc,
            _knowledgeBaseName: knowledgeBaseMap.value.get(doc.knowledgeBaseId),
          }));
          // 加载最新解析日志
          await loadLatestParseLogs(currentPageDocs.value);
          // 合并解析状态到行数据
          const listWithStatus = list.map((doc) => {
            const log = doc.id ? latestLogMap.value.get(doc.id) : undefined;
            return {
              ...doc,
              _parseStatus: log?.status,
              _parseLog: log,
            };
          });
          startPollingIfNeeded();
          return { ...res, list: listWithStatus };
        },
      },
    },
    rowConfig: {
      keyField: 'id',
      isHover: true,
    },
    toolbarConfig: {
      refresh: true,
      search: true,
    },
  } as VxeTableGridOptions<BidDocumentApi.Document>,
});
</script>

<template>
  <Page auto-content-height>
    <UploadModalComp @success="handleUploadSuccess" />
    <ParseLogDrawerComp />

    <Grid table-title="文档列表">
      <template #toolbar-tools>
        <TableAction
          :actions="[
            {
              label: '上传文档',
              type: 'primary',
              icon: ACTION_ICON.ADD,
              auth: ['bid:document:upload'],
              onClick: handleUpload,
            },
          ]"
        />
      </template>

      <!-- 解析状态列 -->
      <template #parseStatus="{ row }">
        <Tag
          v-if="row._parseStatus != null"
          :color="parseStatusTagType[row._parseStatus] ?? 'default'"
        >
          {{ parseStatusText[row._parseStatus] ?? '未解析' }}
        </Tag>
        <span v-else class="text-gray-400">未解析</span>
      </template>

      <!-- 操作列 -->
      <template #actions="{ row }">
        <TableAction
          :actions="[
            {
              label: '开始解析',
              type: 'link',
              icon: 'lucide:play',
              auth: ['bid:document:parse'],
              disabled: row._parseStatus === 0 || row._parseStatus === 1,
              onClick: handleParse.bind(null, row),
            },
            {
              label: '解析日志',
              type: 'link',
              icon: ACTION_ICON.VIEW,
              auth: ['bid:document:query'],
              onClick: handleViewParseLog.bind(null, row),
            },
            {
              label: $t('common.delete'),
              type: 'link',
              danger: true,
              icon: ACTION_ICON.DELETE,
              auth: ['bid:document:delete'],
              popConfirm: {
                title: $t('ui.actionMessage.deleteConfirm', [row.displayName]),
                confirm: handleDelete.bind(null, row),
              },
            },
          ]"
        />
      </template>
    </Grid>
  </Page>
</template>
