<script lang="ts" setup>
import type { TreeExpose } from '@vben/common-ui';

import type { SystemDeptApi } from '#/api/system/dept';
import type { SystemRoleApi } from '#/api/system/role';

import { nextTick, ref } from 'vue';

import { Tree, useVbenModal } from '@vben/common-ui';
import { SystemDataScopeEnum } from '@vben/constants';
import { handleTree } from '@vben/utils';

import { Checkbox, message, Spin } from 'antdv-next';

import { useVbenForm } from '#/adapter/form';
import { getDeptList } from '#/api/system/dept';
import { assignRoleDataScope } from '#/api/system/permission';
import { getRole } from '#/api/system/role';
import { $t } from '#/locales';

import { useAssignDataPermissionFormSchema } from '../data';

const emit = defineEmits(['success']);

const deptTree = ref<SystemDeptApi.Dept[]>([]); // 部门树
const deptLoading = ref(false); // 加载部门列表
const isAllSelected = ref(false); // 全选状态
const isExpanded = ref(false); // 展开状态
const isCheckStrictly = ref(true); // 父子联动状态
const treeRef = ref<TreeExpose>(); // 部门树实例（展开/折叠）

const [Form, formApi] = useVbenForm({
  commonConfig: {
    componentProps: {
      class: 'w-full',
    },
    formItemClass: 'col-span-2',
    labelWidth: 80,
  },
  layout: 'horizontal',
  schema: useAssignDataPermissionFormSchema(),
  showDefaultActions: false,
});

const [Modal, modalApi] = useVbenModal({
  async onConfirm() {
    const { valid } = await formApi.validate();
    if (!valid) {
      return;
    }
    modalApi.lock();
    const data = await formApi.getValues();
    try {
      await assignRoleDataScope({
        roleId: data.id,
        dataScope: data.dataScope,
        dataScopeDeptIds:
          data.dataScope === SystemDataScopeEnum.DEPT_CUSTOM
            ? data.dataScopeDeptIds
            : undefined,
      });
      await modalApi.close();
      emit('success');
      message.success($t('ui.actionMessage.operationSuccess'));
    } finally {
      modalApi.unlock();
    }
  },
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      return;
    }
    const data = modalApi.getData() as SystemRoleApi.Role;
    if (!data || !data.id) {
      return;
    }
    modalApi.lock();
    try {
      // 加载部门列表
      await loadDeptTree();
      // 设置表单值，一定要在加载树之后
      await formApi.setValues(await getRole(data.id));
      // 部门树默认展开全部，方便选择
      isExpanded.value = true;
      await nextTick();
      treeRef.value?.expandAll();
    } finally {
      modalApi.unlock();
    }
  },
});

/** 加载部门树 */
async function loadDeptTree() {
  deptLoading.value = true;
  try {
    const data = await getDeptList();
    deptTree.value = handleTree(data) as SystemDeptApi.Dept[];
  } finally {
    deptLoading.value = false;
  }
}

/** 全选/全不选 */
function handleSelectAll() {
  isAllSelected.value = !isAllSelected.value;
  if (isAllSelected.value) {
    const allIds = getAllNodeIds(deptTree.value);
    formApi.setFieldValue('dataScopeDeptIds', allIds);
  } else {
    formApi.setFieldValue('dataScopeDeptIds', []);
  }
}

/** 展开/折叠所有节点 */
function handleExpandAll() {
  isExpanded.value = !isExpanded.value;
  // default-expanded-keys 只在 Tree 初始化时读一次，改它不会生效；
  // 必须调用 Tree 暴露的方法操作内部 expanded 状态。
  if (isExpanded.value) {
    treeRef.value?.expandAll();
  } else {
    treeRef.value?.collapseAll();
  }
}

/** 切换父子联动 */
function handleCheckStrictly() {
  isCheckStrictly.value = !isCheckStrictly.value;
}

/** 递归获取所有节点 ID */
function getAllNodeIds(nodes: any[], ids: number[] = []): number[] {
  nodes.forEach((node: any) => {
    ids.push(node.id);
    if (node.children && node.children.length > 0) {
      getAllNodeIds(node.children, ids);
    }
  });
  return ids;
}
</script>

<template>
  <Modal title="数据权限" class="w-2/5">
    <Form class="mx-4">
      <template #dataScopeDeptIds="slotProps">
        <Spin :spinning="deptLoading" :classes="{ root: 'w-full' }">
          <Tree
            ref="treeRef"
            :tree-data="deptTree"
            multiple
            bordered
            v-bind="slotProps.componentProps"
            :check-strictly="!isCheckStrictly"
            value-field="id"
            label-field="name"
          />
        </Spin>
      </template>
    </Form>
    <template #prepend-footer>
      <div class="flex flex-auto items-center">
        <Checkbox :checked="isAllSelected" @change="handleSelectAll">
          全选
        </Checkbox>
        <Checkbox :checked="isExpanded" @change="handleExpandAll">
          全部展开
        </Checkbox>
        <Checkbox :checked="isCheckStrictly" @change="handleCheckStrictly">
          父子联动
        </Checkbox>
      </div>
    </template>
  </Modal>
</template>
