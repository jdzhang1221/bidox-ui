<script lang="ts" setup>
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { BidDocumentApi } from '#/api/bid/document';

import { ref } from 'vue';

import { useVbenDrawer } from '@vben/common-ui';

import { Tag } from 'antdv-next';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { getDocumentParseLogList } from '#/api/bid/document';

import {
  parseStatusTagType,
  parseStatusText,
  useParseLogColumns,
} from '../data';

const documentId = ref<number>();
const documentName = ref<string>('');

const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: {
    columns: useParseLogColumns(),
    height: 'auto',
    pagerConfig: {
      enabled: false,
    },
    proxyConfig: {
      ajax: {
        query: async () => {
          if (!documentId.value) return [];
          const data = await getDocumentParseLogList(documentId.value);
          return data.toSorted(
            (a, b) => (b.attemptNo ?? 0) - (a.attemptNo ?? 0),
          );
        },
      },
    },
    rowConfig: {
      keyField: 'id',
      isHover: true,
    },
    toolbarConfig: {
      refresh: true,
    },
  } as VxeTableGridOptions<BidDocumentApi.ParseLog>,
});

const [Drawer, drawerApi] = useVbenDrawer({
  onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      documentId.value = undefined;
      documentName.value = '';
      return;
    }
    const data = drawerApi.getData() as
      | undefined
      | { displayName: string; id: number };
    if (data) {
      documentId.value = data.id;
      documentName.value = data.displayName;
    }
  },
  // 抽屉完全打开、内部 Grid 挂载完成后再查询，避免 commitProxy 未就绪报错
  onOpened() {
    gridApi.query();
  },
});
</script>

<template>
  <Drawer :title="`解析日志 - ${documentName}`">
    <Grid table-title="解析历史">
      <template #logStatus="{ row }">
        <Tag :color="parseStatusTagType[row.status] ?? 'default'">
          {{ parseStatusText[row.status] ?? '未知' }}
        </Tag>
      </template>
    </Grid>
  </Drawer>
</template>
