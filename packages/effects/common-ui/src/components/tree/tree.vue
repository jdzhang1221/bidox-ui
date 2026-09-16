<script setup lang="ts">
import type { TreeProps } from '@vben-core/shadcn-ui';

import type { TreeExpose } from './types';

import { ref } from 'vue';

import { Inbox } from '@vben/icons';
import { $t } from '@vben/locales';

import { treePropsDefaults, VbenTree } from '@vben-core/shadcn-ui';

const props = withDefaults(defineProps<TreeProps>(), treePropsDefaults());

const treeRef = ref<TreeExpose>();

/**
 * 透传底层 `VbenTree` 通过 `defineExpose` 暴露的方法。
 *
 * 包装组件**不会**继承被包装组件的 exposed：不写这段转发的话，父组件通过
 * `ref` 拿到的是本组件的 exposed（`<script setup>` 下默认是空对象），
 * `treeRef.value.expandAll` 会是 `undefined` —— 调用方不报错、只是没反应，
 * 非常难排查。典型受害者是「全部展开 / 全选」这类按钮。
 */
defineExpose({
  checkAll: () => treeRef.value?.checkAll(),
  collapseAll: () => treeRef.value?.collapseAll(),
  collapseNodes: (value: (number | string)[] | number | string) =>
    treeRef.value?.collapseNodes(value),
  expandAll: () => treeRef.value?.expandAll(),
  expandNodes: (value: (number | string)[] | number | string) =>
    treeRef.value?.expandNodes(value),
  expandToLevel: (level: number) => treeRef.value?.expandToLevel(level),
  getItemByValue: (value: number | string) =>
    treeRef.value?.getItemByValue(value),
  unCheckAll: () => treeRef.value?.unCheckAll(),
});
</script>

<template>
  <VbenTree ref="treeRef" v-if="props.treeData?.length > 0" v-bind="props">
    <template v-for="(_, key) in $slots" :key="key" #[key]="slotProps">
      <slot :name="key" v-bind="slotProps"> </slot>
    </template>
  </VbenTree>
  <div
    v-else
    class="flex-col-center cursor-pointer rounded-lg border p-10 text-sm font-medium text-muted-foreground"
  >
    <Inbox class="size-10" />
    <div class="mt-1">{{ $t('common.noData') }}</div>
  </div>
</template>
