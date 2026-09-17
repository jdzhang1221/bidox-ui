import { createPinia, setActivePinia } from 'pinia';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { useGridFormSchema, useUploadFormSchema } from '../data';

// 本文件只校验 schema 契约，把 API 层 mock 掉：
// 真实的 `#/api/bid/knowledge-base` 会经 request client 拉进 antdv-next 的组件链，
// 在 vitest 下触发 `@v-c/picker` → `dayjs/plugin/advancedFormat` 的 ESM 解析失败。
vi.mock('#/api/bid/knowledge-base', () => ({
  getKnowledgeBaseSimpleList: vi.fn(),
}));

// data.ts 顶层会 import `#/api/bid/knowledge-base`，挂个 Pinia 防止副作用报错
beforeAll(() => {
  setActivePinia(createPinia());
});

/**
 * 文档管理页 `ApiSelect` 字段的 model prop 契约回归。
 *
 * ## 背景（真实事故）
 *
 * 上传弹窗里「知识库」明明选中了、UI 也显示出来了，点确认却报「请选择知识库」，
 * 上传请求根本没发出去（Network 面板零请求）。
 *
 * 根因：schema 里写成了 `modelPropName: 'modelValue'`。
 *
 * `ApiSelect` 是 `withDefaultPlaceholder(ApiComponent, 'select', { modelPropName: 'value' })`
 * 包装出来的 —— 适配层已经把 `modelPropName` 传成 `'value'`，于是 `ApiComponent` 内
 * `usesDefaultModelValue`（`['model-value','modelValue'].includes(props.modelPropName)`）
 * 为 **false**，取值与回写**只走 attrs 的 `value` / `onUpdate:value`**，
 * `defineModel()` 那条通道被彻底旁路。
 *
 * 写 `'modelValue'` 时的实际链路：
 * 1. 表单值经 `v-model:modelValue` 进 `defineModel`（组件内部其实收到了）；
 * 2. 但 `currentModelValue` 读的是 `attrs['value']` → **undefined**；
 * 3. 用户选择后，`updateModelValue()` 去调 `attrs['onUpdate:value']` → **不存在** → 丢弃。
 *
 * 结果：字段在表单 model 里永远是 `undefined`，`selectRequired` 判定失败。
 * 而 antd Select 对 `value=undefined` 会退回内部非受控态，所以**UI 上"看起来选中了"**，
 * 极具迷惑性 —— 表现为「选了知识库还提示请选择知识库」。
 *
 * ## 修复
 *
 * `modelPropName: 'value'`（与 adapter 的 `baseModelPropName: 'value'` 对齐）。
 *
 * ## ⚠️ 与 role / tenantPackage 的 menuIds 相反，别一刀切
 *
 * `views/system/role`、`views/system/tenantPackage` 里的 `menuIds` 是
 * `component: 'Input'` + `#menuIds` 插槽渲染 `Tree`，`Tree` 用 `defineModel()`，
 * 那边**必须**写 `'modelValue'`。
 *
 * 判断口诀：**看真正接收 v-model 的那个组件是谁**
 * —— 插槽里的原生 / `defineModel` 组件 → `'modelValue'`；
 * —— adapter 里注册的 `ApiXxx`（经 ApiComponent 包装）→ `'value'`。
 */
describe('文档管理页 ApiSelect 字段的 model prop 契约', () => {
  it('上传表单 knowledgeBaseId 必须声明 modelPropName=value', () => {
    const field = useUploadFormSchema().find(
      (schema) => schema.fieldName === 'knowledgeBaseId',
    );

    expect(field).toBeDefined();
    expect(field?.component).toBe('ApiSelect');
    expect(field?.modelPropName).toBe('value');
  });

  it('搜索表单 knowledgeBaseId 必须声明 modelPropName=value', () => {
    const field = useGridFormSchema().find(
      (schema) => schema.fieldName === 'knowledgeBaseId',
    );

    expect(field).toBeDefined();
    expect(field?.component).toBe('ApiSelect');
    expect(field?.modelPropName).toBe('value');
  });

  it('同页普通 Select 字段不应被误加 modelPropName（防止一刀切）', () => {
    const type = useUploadFormSchema().find(
      (schema) => schema.fieldName === 'documentType',
    );

    expect(type?.component).toBe('Select');
    // 普通 Select 走 adapter 的 baseModelPropName('value')，无需显式声明
    expect(type?.modelPropName).toBeUndefined();
  });
});
