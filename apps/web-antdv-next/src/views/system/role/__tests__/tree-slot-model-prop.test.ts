import { createPinia, setActivePinia } from 'pinia';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  useAssignDataPermissionFormSchema,
  useAssignMenuFormSchema,
} from '../data';

// data.ts 里的 schema 会调 getDictOptions()，它依赖 Pinia 的 dict store。
beforeAll(() => {
  setActivePinia(createPinia());
});

/**
 * 角色弹窗里「Tree 插槽字段」的 model prop 契约回归。
 *
 * ## 背景（真实事故）
 *
 * `menuIds` / `dataScopeDeptIds` 在 schema 里声明成 `component: 'Input'`，
 * 真正的渲染由 `#<fieldName>` 插槽接管，插槽里放的是 `Tree`。
 * 而 `Tree` 用的是 `defineModel()`，只认 `modelValue` / `onUpdate:modelValue`。
 *
 * adapter 把 `baseModelPropName` 设成 `'value'`（antd 组件惯例），
 * `form-render/form-field.vue` 在 `modelPropName !== 'modelValue'` 时会执行：
 *
 * ```js
 * Reflect.deleteProperty(binds, 'modelValue');
 * Reflect.deleteProperty(binds, 'onUpdate:modelValue');
 * ```
 *
 * 于是插槽拿到的 `componentProps` 里只剩 `value` / `onUpdate:value`，
 * `Tree` 两边都收不到，**回显与保存同时失效，且不抛任何错**：
 * 打开弹窗勾选 → 确定 → 表单里 `menuIds` 还是打开时的旧值（空数组）
 * → 接口收到 `menuIds: []` → 角色菜单被清空。
 * 用户看到的现象就是「保存后再打开，菜单权限没保存上」。
 *
 * ## 修复
 *
 * 显式声明 `modelPropName: 'modelValue'`。这里把契约锁死，防止后续重构又把它删掉。
 *
 * ⚠️ 这条规则**只适用于「插槽渲染 defineModel 组件」**的场景（本文件的两个字段
 * 都是 `component: 'Input'` + `#<fieldName>` 插槽放 `Tree`）。
 * 适配层组件（`ApiSelect` / `ApiTreeSelect` / `ApiCascader`）恰好相反：它们经
 * `withDefaultPlaceholder` 包装后，对外的 v-model 名是 **`value`**，
 * 写成 `'modelValue'` 反而会静默断链（值进 defineModel，组件却读 attrs.value）。
 * 见 `views/bid/document/__tests__/api-select-model-prop.test.ts`。
 *
 * 判断口诀：**看真正接收 v-model 的那个组件是谁**
 * —— 是插槽里的原生/defineModel 组件 → `'modelValue'`；
 * —— 是 adapter 里注册的 `ApiXxx` → `'value'`。
 *
 * ## 机制本身在哪测
 *
 * `packages/@core/ui-kit/form-ui/__tests__/form-integration.test.ts`
 * 的 "keeps only the active model protocol in field slot componentProps"
 * 已经双向覆盖了 form-field 的删除行为（default 通道保留 `modelValue`、
 * `modelPropName: 'value'` 通道删除 `modelValue`）。本文件只补应用层契约。
 */
describe('角色弹窗 Tree 插槽字段的 model prop 契约', () => {
  it('菜单权限 menuIds 必须声明 modelPropName=modelValue', () => {
    const field = useAssignMenuFormSchema().find(
      (schema) => schema.fieldName === 'menuIds',
    );

    expect(field).toBeDefined();
    expect(field?.modelPropName).toBe('modelValue');
  });

  it('部门范围 dataScopeDeptIds 必须声明 modelPropName=modelValue', () => {
    const field = useAssignDataPermissionFormSchema().find(
      (schema) => schema.fieldName === 'dataScopeDeptIds',
    );

    expect(field).toBeDefined();
    expect(field?.modelPropName).toBe('modelValue');
  });
});
