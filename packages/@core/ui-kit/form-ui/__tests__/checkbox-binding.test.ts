import type { VueWrapper } from '@vue/test-utils';

import { flushPromises, mount } from '@vue/test-utils';

import { VbenCheckbox } from '@vben-core/shadcn-ui';

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { useVbenForm } from '../src/use-vben-form';

const wrappers: VueWrapper[] = [];

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) {
    wrapper.unmount();
  }
});

function createAgreePolicyForm() {
  return useVbenForm({
    schema: [
      {
        component: 'VbenCheckbox',
        defaultValue: false,
        fieldName: 'agreePolicy',
        rules: z
          .boolean()
          .refine((value) => !!value, { message: '请同意隐私政策和条款' }),
      },
    ],
  });
}

/**
 * 回归锁：`VbenCheckbox` 的表单绑定必须走 `modelValue` 通道。
 *
 * 背景（上游 vben 至今未修的 bug）：`@vben-core/shadcn-ui` 的 `checkbox.vue` 用的是
 * **无参** `defineModel<boolean>()`，它的模型 prop 就是 `modelValue`，不存在 `checked`。
 * 而 `config.ts` 的 `COMPONENT_BIND_EVENT_MAP` 曾把 `VbenCheckbox` 登记成 `'checked'`，
 * 于是 `form-field.vue` 会执行：
 *
 * ```js
 * if (bindEventField && bindEventField !== 'modelValue') {
 *   Reflect.deleteProperty(binds, 'modelValue');
 *   Reflect.deleteProperty(binds, 'onUpdate:modelValue');
 * }
 * ```
 *
 * 把 `modelValue` / `onUpdate:modelValue` **删掉**、改传 `checked` / `onUpdate:checked` ——
 * 这两个都落到 `$attrs` 上被静默忽略。后果：勾选框**视觉上能勾、表单值却永不更新**，
 * 注册页勾了「我同意隐私条款」仍报「请同意隐私政策和条款」。
 *
 * 一旦有人把 `COMPONENT_BIND_EVENT_MAP` 改回 `{ VbenCheckbox: 'checked' }`，本用例即失败。
 */
describe('vbenCheckbox 的表单绑定契约', () => {
  it('form-field 必须传 modelValue 通道，不得传 checked', async () => {
    let capturedComponentProps: Record<string, any> | undefined;
    const [Form] = createAgreePolicyForm();

    const wrapper = mount(Form, {
      slots: {
        agreePolicy(slotProps: Record<string, any>) {
          capturedComponentProps = slotProps.componentProps;
          return null;
        },
      },
    });
    wrappers.push(wrapper);
    await flushPromises();

    expect(capturedComponentProps).toBeDefined();
    expect(capturedComponentProps).toHaveProperty('modelValue');
    expect(capturedComponentProps).toHaveProperty('onUpdate:modelValue');
    expect(capturedComponentProps).not.toHaveProperty('checked');
    expect(capturedComponentProps).not.toHaveProperty('onUpdate:checked');
  });

  it('勾选后表单值必须变为 true（真实组件 + 真实点击）', async () => {
    const [Form, formApi] = createAgreePolicyForm();

    const wrapper = mount(Form);
    wrappers.push(wrapper);
    await flushPromises();

    const checkbox = wrapper.findComponent(VbenCheckbox);
    expect(checkbox.exists()).toBe(true);

    // 表单值 → 控件
    expect(checkbox.props('modelValue')).toBe(false);
    await formApi.setValues({ agreePolicy: true });
    await flushPromises();
    expect(checkbox.props('modelValue')).toBe(true);

    // 控件 → 表单值（注册页「我同意隐私条款」的交互路径）
    await formApi.setValues({ agreePolicy: false });
    await flushPromises();
    expect(
      (
        wrapper.get('button[data-slot="checkbox"]').element as HTMLElement
      ).getAttribute('aria-checked'),
    ).toBe('false');

    await wrapper.get('button[data-slot="checkbox"]').trigger('click');
    await flushPromises();

    const values = await formApi.getValues();
    expect(values.agreePolicy).toBe(true);
    expect(
      (
        wrapper.get('button[data-slot="checkbox"]').element as HTMLElement
      ).getAttribute('aria-checked'),
    ).toBe('true');
  });
});
