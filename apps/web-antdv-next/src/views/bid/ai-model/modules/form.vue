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
 * 上一次「已知」的提供方。
 *
 * 用途是让「切换提供方 → 回填 baseUrl / model」**只在用户真的改了提供方时**触发：
 * 打开编辑弹窗时会 `setValues` 一次全量数据，那也会让 `provider` 出现在
 * `fieldsChanged` 里，若不加这道闸门，用户存好的 baseUrl / model 会被预设值冲掉。
 */
let lastProvider: string | undefined;

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
    if (!fieldsChanged.includes('provider')) {
      return;
    }
    const provider = values.provider as string | undefined;
    // 与「已知值」相同 = 本次变化不是用户切提供方（例如弹窗刚打开时的批量回填）
    if (provider === lastProvider) {
      return;
    }
    lastProvider = provider;
    const preset = PROVIDER_PRESET[String(provider ?? '')];
    if (!preset) {
      return;
    }
    // 切换提供方后旧的地址/模型几乎必然失效，直接覆盖；用户随后可以手改
    formApi.setValues({ baseUrl: preset.baseUrl, model: preset.model });
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
      lastProvider = undefined;
      return;
    }
    const data = modalApi.getData() as BidAiModelApi.AiModel;
    if (!data || !data.id) {
      // 新增：租户由系统右上角切换器决定，表单里没有也不该有 tenantId。
      // `enabled` 默认 0（未启用）—— 新建一条配置不该顺手把租户正在用的模型换掉，
      // 要切换必须由用户在表单里显式打开开关。
      lastProvider = undefined;
      await formApi.setValues({ enabled: 0 });
      return;
    }
    modalApi.lock();
    try {
      formData.value = await getAiModel(data.id);
      // 接口永不返回密钥，所以这里一定为空 —— 空即「不修改」。
      await formApi.setValues({ ...formData.value, apiKey: '' });
      // 记下已加载的提供方，避免上面这次批量回填被当成「用户切换了提供方」
      lastProvider = formData.value.provider;
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
