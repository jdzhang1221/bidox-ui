<script lang="ts" setup>
import type { BidKnowledgeBaseApi } from '#/api/bid/knowledge-base';

import { computed, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { message } from 'antdv-next';

import { useVbenForm } from '#/adapter/form';
import {
  createKnowledgeBase,
  getKnowledgeBase,
  updateKnowledgeBase,
} from '#/api/bid/knowledge-base';
import { $t } from '#/locales';

import { useFormSchema } from '../data';

const emit = defineEmits(['success']);
const formData = ref<BidKnowledgeBaseApi.KnowledgeBase>();
const getTitle = computed(() => {
  return formData.value?.id
    ? $t('ui.actionTitle.edit', ['知识库'])
    : $t('ui.actionTitle.create', ['知识库']);
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
});

const [Modal, modalApi] = useVbenModal({
  async onConfirm() {
    const { valid } = await formApi.validate();
    if (!valid) {
      return;
    }
    modalApi.lock();
    const data =
      (await formApi.getValues()) as BidKnowledgeBaseApi.KnowledgeBase;
    try {
      await (formData.value?.id
        ? updateKnowledgeBase(data)
        : createKnowledgeBase(data));
      await modalApi.close();
      emit('success');
      message.success($t('ui.actionMessage.operationSuccess'));
    } finally {
      modalApi.unlock();
    }
  },
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      formData.value = undefined;
      return;
    }
    const data = modalApi.getData() as BidKnowledgeBaseApi.KnowledgeBase;
    if (!data || !data.id) {
      await formApi.setValues(data ?? {});
      return;
    }
    modalApi.lock();
    try {
      formData.value = await getKnowledgeBase(data.id);
      await formApi.setValues(formData.value);
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
