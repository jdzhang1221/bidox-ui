<script lang="ts" setup>
import type { BidAiModelApi } from '#/api/bid/ai-model';

import { computed, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { message } from 'antdv-next';

import { useVbenForm } from '#/adapter/form';
import { createAiModel, getAiModel, updateAiModel } from '#/api/bid/ai-model';
import { $t } from '#/locales';

import { PROVIDER_PRESET, useFormSchema } from '../data';

const emit = defineEmits(['success']);
const formData = ref<BidAiModelApi.AiModel>();

/**
 * 是否处于「程序化回填」中。
 *
 * ⚠️ 这是本文件最容易写错的一处，改动前务必读完。
 *
 * 需求：`provider` 变化时要把 `baseUrl` / `model` 回填成该提供方的预设值，
 * 但**只有用户手动切换提供方时**才该回填 —— 打开编辑弹窗时的整批回填
 * 绝不能被预设值冲掉，否则用户会看到「保存成功，再打开却变回旧值」。
 *
 * 之前用 `lastProvider !== provider` 当闸门，**行不通**：
 *
 * ```js
 * await formApi.setValues({ ...formData.value });   // ← handleValuesChange 在这里【同步】触发
 * lastProvider = formData.value.provider;           // ← 这行还没执行
 * ```
 *
 * 闸门变量是在它要拦截的那次回调**之后**才赋值的，所以第一次必然漏过；
 * 更糟的是漏过时写的预设值会再触发一轮 `handleValuesChange`，
 * 把刚从库里读出来的 `baseUrl` / `model` 覆盖掉（实测日志：
 * 第一轮 `lastProvider=undefined` 放行 → 第二轮 `changed=["baseUrl"]` 已是预设值）。
 *
 * 因此改用**显式的作用域门闩**：所有程序化 `setValues` 都包在
 * {@link withFormLoading} 里，回调只看这个布尔量，不再猜「这次变化是谁引起的」。
 */
let formLoading = false;

/**
 * 在「程序化回填」作用域内执行操作，期间禁用提供方联动。
 *
 * 用 try/finally 而不是手动置位，保证中途抛异常时门闩一定会复位 ——
 * 否则一次失败会让该弹窗实例永久失去提供方联动。
 */
async function withFormLoading<T>(fn: () => Promise<T>): Promise<T> {
  formLoading = true;
  try {
    return await fn();
  } finally {
    formLoading = false;
  }
}

const getTitle = computed(() => {
  return formData.value?.id
    ? $t('ui.actionTitle.edit', ['AI 模型配置'])
    : $t('ui.actionTitle.create', ['AI 模型配置']);
});

const [Form, formApi] = useVbenForm({
  commonConfig: {
    componentProps: {
      class: 'w-full',
    },
    formItemClass: 'col-span-2',
    labelWidth: 100,
  },
  layout: 'horizontal',
  schema: useFormSchema(),
  showDefaultActions: false,
  handleValuesChange(values, fieldsChanged) {
    // 程序化回填（打开弹窗置初值、下面回填预设值本身）一律放行不管
    if (formLoading) {
      return;
    }
    if (!fieldsChanged.includes('provider')) {
      return;
    }
    const preset = PROVIDER_PRESET[String(values.provider ?? '')];
    if (!preset) {
      return;
    }
    // 切换提供方后旧的地址/模型几乎必然失效，直接覆盖；用户随后可以手改。
    // 这次写入自己要包在 formLoading 里，否则它会递归地再进一次本回调
    // （写 baseUrl → 触发 changed=["baseUrl"]）。
    withFormLoading(() =>
      formApi.setValues({ baseUrl: preset.baseUrl, model: preset.model }),
    );
  },
});

const [Modal, modalApi] = useVbenModal({
  async onConfirm() {
    const { valid } = await formApi.validate();
    if (!valid) {
      return;
    }
    modalApi.lock();
    const data = (await formApi.getValues()) as BidAiModelApi.AiModelSaveParams;
    // 编辑时密钥留空 = 不修改：后端会回填旧值。传空串反而会被当成「把密钥清空」。
    if (formData.value?.id && !data.apiKey) {
      delete data.apiKey;
    }
    try {
      await (formData.value?.id ? updateAiModel(data) : createAiModel(data));
      await modalApi.close();
      emit('success');
      message.success($t('ui.actionMessage.operationSuccess'));
    } catch {
      // 保存失败（如后端「该提供方必须配置 API Key」）：全局
      // errorMessageResponseInterceptor 已经用后端 msg 提示过了，这里只需要吞掉 rejection。
      // 不吞的话它会冒泡成 unhandled rejection，在控制台留一条 pageerror。
      // 弹窗保持打开、由 finally 解锁，让用户就地改。
    } finally {
      modalApi.unlock();
    }
  },
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      formData.value = undefined;
      return;
    }
    const data = modalApi.getData() as BidAiModelApi.AiModel;
    if (!data || !data.id) {
      // 新增：租户由系统右上角切换器决定，表单里没有也不该有 tenantId。
      // `enabled` 默认 0（未启用）—— 新建一条配置不该顺手把租户正在用的模型换掉，
      // 要切换必须由用户在表单里显式打开开关。
      //
      // 注意这里同样要走 withFormLoading：`provider` 若残留上一轮的选中值，
      // 置初值也会进 handleValuesChange。
      await withFormLoading(() => formApi.setValues({ enabled: 0 }));
      return;
    }
    modalApi.lock();
    try {
      formData.value = await getAiModel(data.id);
      // ⚠️ 这次整批回填必须包在 withFormLoading 里，否则 handleValuesChange 会把
      // 刚从库里读出来的 baseUrl / model 覆盖成提供方预设值 ——
      // 这正是「保存成功，再打开却显示没保存上」的成因。
      // 接口永不返回密钥，所以 apiKey 一定为空 —— 空即「不修改」。
      await withFormLoading(() =>
        formApi.setValues({ ...formData.value, apiKey: '' }),
      );
    } finally {
      modalApi.unlock();
    }
  },
});
</script>

<template>
  <Modal :title="getTitle">
    <Form class="mx-4" />
  </Modal>
</template>
