import type { TreeExpose } from '../types';

import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

import { describe, expect, it } from 'vitest';

import Tree from '../tree.vue';

const treeData = [
  {
    id: 1,
    name: 'parent',
    children: [
      { id: 2, name: 'child-2' },
      { id: 3, name: 'child-3' },
    ],
  },
];

function mountTree() {
  const treeRef = ref<TreeExpose>();
  const wrapper = mount(
    defineComponent({
      setup() {
        return () =>
          h(Tree, {
            labelField: 'name',
            multiple: true,
            ref: treeRef,
            treeData,
            valueField: 'id',
          });
      },
    }),
  );
  return { treeRef, wrapper };
}

/**
 * `Tree` 是对 `@vben-core/shadcn-ui` 的 `VbenTree` 的包装组件。
 *
 * 包装组件**不会**继承被包装组件的 `exposed`。漏掉转发时，
 * `treeRef.value.expandAll` 是 `undefined`：不报错、只是点了「全部展开」没反应。
 * 这个 bug 已经在角色/套餐弹窗里真实发生过，所以这里锁死转发契约。
 */
describe('tree 包装组件的方法透传', () => {
  it('把底层实例方法暴露给父组件（不再是 undefined）', async () => {
    const { treeRef } = mountTree();
    await nextTick();

    expect(treeRef.value).toBeDefined();
    for (const method of [
      'checkAll',
      'collapseAll',
      'collapseNodes',
      'expandAll',
      'expandNodes',
      'expandToLevel',
      'getItemByValue',
      'unCheckAll',
    ] as const) {
      expect(typeof treeRef.value?.[method], `${method} 未被透传`).toBe(
        'function',
      );
    }
  });

  it('expandAll / collapseAll 真的作用到底层树', async () => {
    const { treeRef, wrapper } = mountTree();
    await nextTick();

    // 初始全折叠：只渲染根节点
    expect(wrapper.findAll('.tree-node')).toHaveLength(1);

    treeRef.value?.expandAll();
    await nextTick();
    expect(wrapper.findAll('.tree-node')).toHaveLength(3);

    treeRef.value?.collapseAll();
    await nextTick();
    expect(wrapper.findAll('.tree-node')).toHaveLength(1);
  });
});
