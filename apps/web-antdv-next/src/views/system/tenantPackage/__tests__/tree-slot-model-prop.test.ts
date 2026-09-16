import { createPinia, setActivePinia } from 'pinia';
import { beforeAll, describe, expect, it } from 'vitest';

import { useFormSchema } from '../data';

// useFormSchema() 里的 status 字段会调 getDictOptions()，它依赖 Pinia 的 dict store。
beforeAll(() => {
  setActivePinia(createPinia());
});

/**
 * 租户套餐弹窗里「Tree 插槽字段」的 model prop 契约回归。
 *
 * 与 `views/system/role/__tests__/tree-slot-model-prop.test.ts` 同源：
 * `menuIds` 在 schema 里是 `component: 'Input'`，实际由 `#menuIds` 插槽渲染成
 * `Tree`（`defineModel()`，只认 `modelValue`）。adapter 的
 * `baseModelPropName` 是 `'value'`，form-field 会把 `modelValue` /
 * `onUpdate:modelValue` 从插槽 `componentProps` 里删掉，导致回显与保存同时失效
 * —— 保存时 `menuIds` 恒为空数组，会把套餐的菜单权限清空。
 *
 * 修复：显式声明 `modelPropName: 'modelValue'`。此处锁死防回归。
 */
describe('租户套餐弹窗 Tree 插槽字段的 model prop 契约', () => {
  it('菜单权限 menuIds 必须声明 modelPropName=modelValue', () => {
    const field = useFormSchema().find(
      (schema) => schema.fieldName === 'menuIds',
    );

    expect(field).toBeDefined();
    expect(field?.modelPropName).toBe('modelValue');
  });
});
