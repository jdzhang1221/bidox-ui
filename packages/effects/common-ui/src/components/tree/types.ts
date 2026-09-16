/**
 * `Tree`（`components/tree/tree.vue`）通过 `defineExpose` 暴露给父组件的实例方法。
 *
 * 为什么不直接用 `InstanceType<typeof Tree>`：
 * vue-tsc 目前无法从 SFC 的 `defineExpose` 推断出实例方法（`Tree` 的
 * `typeof` 只带 `$props` 等公共属性，没有 `expandAll` 等），直接写会得到
 * `TS2339: Property 'expandAll' does not exist`。这里显式声明一份契约。
 *
 * 注意：`Tree` 是对 `@vben-core/shadcn-ui` 的 `VbenTree` 的包装组件，
 * 包装组件**不会**继承被包装组件的 exposed，必须手动转发（见 tree.vue）。
 */
export interface TreeExpose {
  /** 全选（仅 `multiple` 时生效） */
  checkAll: () => void;
  /** 折叠所有节点 */
  collapseAll: () => void;
  /** 折叠指定节点 */
  collapseNodes: (value: ArrayableValue) => void;
  /** 展开所有节点 */
  expandAll: () => void;
  /** 展开指定节点 */
  expandNodes: (value: ArrayableValue) => void;
  /** 展开到指定层级 */
  expandToLevel: (level: number) => void;
  /** 按值取节点内部数据 */
  getItemByValue: (value: number | string) => unknown;
  /** 取消全选（仅 `multiple` 时生效） */
  unCheckAll: () => void;
}

/** 单值或值数组（对应底层用到的 `Arrayable`） */
type ArrayableValue = (number | string)[] | number | string;
