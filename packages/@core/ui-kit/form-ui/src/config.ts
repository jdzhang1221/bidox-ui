import type { Component } from 'vue';

import type {
  BaseFormComponentType,
  FormCommonConfig,
  VbenFormAdapterOptions,
} from './types';

import { h } from 'vue';

import {
  VbenButton,
  VbenCheckbox,
  Input as VbenInput,
  VbenInputPassword,
  VbenPinInput,
  VbenSelect,
} from '@vben-core/shadcn-ui';
import { globalShareState } from '@vben-core/shared/global-state';

import VbenFormFieldArray from './components/form-field-array.vue';
import { warnDeprecatedOnce } from './deprecation';
import { registerFormRules } from './rule-registry';

const DEFAULT_MODEL_PROP_NAME = 'modelValue';

export const DEFAULT_FORM_COMMON_CONFIG: FormCommonConfig = {};

export const COMPONENT_MAP: Record<BaseFormComponentType, Component> = {
  DefaultButton: h(VbenButton, { size: 'sm', variant: 'outline' }),
  PrimaryButton: h(VbenButton, { size: 'sm', variant: 'default' }),
  VbenCheckbox,
  VbenFormFieldArray,
  VbenInput,
  VbenInputPassword,
  VbenPinInput,
  VbenSelect,
};

/**
 * 组件 → **非标准**模型 prop 名（`modelValue` 之外的才需要登记）。
 *
 * ⚠️ **不要**再给 `VbenCheckbox` 登记 `'checked'`（上游 vben 至今仍这么写，是上游 bug）。
 *
 * `@vben-core/shadcn-ui` 的 `checkbox.vue` 用的是**无参** `defineModel<boolean>()`，
 * 它的模型 prop 就是 **`modelValue`**，不存在 `checked` 这个 prop；
 * `login.vue` 的「记住我」与 `workbench-todo.vue` 也都是 `v-model` 直连。
 *
 * 一旦登记成 `'checked'`，`form-field` 会走
 * `if (bindEventField !== 'modelValue') Reflect.deleteProperty(binds, 'modelValue')`，
 * 把 `modelValue` / `onUpdate:modelValue` **删掉**、改传 `checked` / `onUpdate:checked` ——
 * 这两个都落到 `$attrs` 上被忽略。后果是**勾选框视觉上能勾、表单值却永不更新**：
 * 注册页勾了「我同意隐私条款」仍报「请同意隐私政策和条款」。
 *
 * 判定方法：勾选后在 DevTools 里看 `VbenCheckbox` 实例的 `props` ——
 * 只有 `modelValue`，`checked` 恒为 `undefined`。
 *
 * ⚠️ 注意本文件是**核心包**：应用侧 `adapter/form.ts` 的 `modelPropNameMap` 修不了这个问题，
 * 因为 `setupVbenForm` 的循环只遍历**应用注册的组件**，而 `VbenCheckbox` 不在其中。
 */
export const COMPONENT_BIND_EVENT_MAP: Partial<
  Record<BaseFormComponentType, string>
> = {};

export function setupVbenForm<
  T extends BaseFormComponentType = BaseFormComponentType,
>(options: VbenFormAdapterOptions<T>) {
  const { config, defineRules, rules } = options;

  const { changeEventFallback = false, emptyStateValue = undefined } =
    (config || {}) as FormCommonConfig;

  Object.assign(DEFAULT_FORM_COMMON_CONFIG, {
    changeEventFallback,
    emptyStateValue,
  });

  if (defineRules) {
    warnDeprecatedOnce(
      'setup-vben-form-define-rules',
      '[Vben Form] `setupVbenForm({ defineRules })` is deprecated. Use `setupVbenForm({ rules })` instead.',
    );
    registerFormRules(defineRules);
  }
  if (rules) {
    registerFormRules(rules);
  }

  const baseModelPropName =
    config?.baseModelPropName ?? DEFAULT_MODEL_PROP_NAME;
  const modelPropNameMap = config?.modelPropNameMap as
    | Record<BaseFormComponentType, string>
    | undefined;

  const components = globalShareState.getComponents();

  for (const component of Object.keys(components)) {
    const key = component as BaseFormComponentType;
    COMPONENT_MAP[key] = components[component as never];

    if (baseModelPropName !== DEFAULT_MODEL_PROP_NAME) {
      COMPONENT_BIND_EVENT_MAP[key] = baseModelPropName;
    }

    // 覆盖特殊组件的modelPropName
    if (modelPropNameMap && modelPropNameMap[key]) {
      COMPONENT_BIND_EVENT_MAP[key] = modelPropNameMap[key];
    }
  }
}
