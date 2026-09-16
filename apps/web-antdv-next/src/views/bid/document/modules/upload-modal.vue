<script lang="ts" setup>
import { computed, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { IconifyIcon } from '@vben/icons';

import { message, Progress, Upload } from 'antdv-next';

import { useVbenForm } from '#/adapter/form';
import { uploadDocument } from '#/api/bid/document';

import { useUploadFormSchema } from '../data';

const emit = defineEmits(['success']);
const selectedFile = ref<File>();
const uploading = ref(false);
const uploadProgress = ref(0);

/**
 * 单文件大小上限，需与后端 BidDocumentServiceImpl.MAX_FILE_SIZE（50MB）
 * 以及 application.yaml 的 spring.servlet.multipart.max-file-size 保持一致。
 */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** 校验文件是否可上传；不通过时给出提示并返回 false */
function validateFile(file: File): boolean {
  if (!file.name.toLowerCase().endsWith('.docx')) {
    message.error('目前仅支持上传 .docx 格式文档');
    return false;
  }
  if (file.size <= 0) {
    message.error('文件内容为空，请重新选择');
    return false;
  }
  if (file.size > MAX_FILE_SIZE) {
    const limit = MAX_FILE_SIZE / 1024 / 1024;
    message.error(
      `文件大小不能超过 ${limit}MB，当前为 ${(file.size / 1024 / 1024).toFixed(1)}MB`,
    );
    return false;
  }
  return true;
}

const [Form, formApi] = useVbenForm({
  commonConfig: {
    componentProps: {
      class: 'w-full',
    },
    formItemClass: 'col-span-2',
    labelWidth: 100,
  },
  layout: 'horizontal',
  schema: useUploadFormSchema(),
  showDefaultActions: false,
});

const [Modal, modalApi] = useVbenModal({
  async onConfirm() {
    const { valid } = await formApi.validate();
    if (!valid) {
      return;
    }
    if (!selectedFile.value) {
      message.error('请选择要上传的文档文件');
      return;
    }
    if (!validateFile(selectedFile.value)) {
      return;
    }
    modalApi.lock();
    uploading.value = true;
    uploadProgress.value = 0;
    try {
      const values = await formApi.getValues();
      await uploadDocument(
        {
          file: selectedFile.value,
          knowledgeBaseId: values.knowledgeBaseId,
          displayName: values.displayName,
          documentType: values.documentType,
        },
        (event) => {
          if (event.total) {
            uploadProgress.value = Math.round(
              (event.loaded / event.total) * 100,
            );
          }
        },
      );
      await modalApi.close();
      emit('success');
      message.success('文档上传成功');
    } catch (error) {
      // 失败原因已由请求拦截器统一 toast（如「上传文件过大，请调整后重试」），
      // 这里只兜住异常：避免 unhandled rejection，并保持弹窗打开便于用户重试。
      console.warn('[bid/document] 上传失败:', error);
    } finally {
      uploading.value = false;
      modalApi.unlock();
    }
  },
  onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      selectedFile.value = undefined;
      uploadProgress.value = 0;
    }
  },
});

const beforeUpload = (file: File) => {
  if (!validateFile(file)) {
    // LIST_IGNORE: 不把非法文件加入上传列表(返回 false 会残留在列表里)
    selectedFile.value = undefined;
    return Upload.LIST_IGNORE;
  }
  selectedFile.value = file;
  // 返回 false: 阻止自动上传,由弹窗「确认」按钮统一提交
  return false;
};

const progressStatus = computed(() =>
  uploadProgress.value === 100 ? 'success' : 'active',
);
</script>

<template>
  <Modal title="上传文档">
    <Form class="mx-4" />
    <div class="mx-4 mt-4">
      <Upload.Dragger
        :before-upload="beforeUpload"
        :max-count="1"
        :show-upload-list="true"
        accept=".docx"
      >
        <p class="ant-upload-drag-icon">
          <IconifyIcon icon="lucide:cloud-upload" />
        </p>
        <p class="ant-upload-text">点击或拖拽 .docx 文件到此区域上传</p>
        <p class="ant-upload-hint">目前仅支持上传 .docx 格式的招标文件</p>
      </Upload.Dragger>
      <Progress
        v-if="uploading"
        class="mt-3"
        :percent="uploadProgress"
        :status="progressStatus"
      />
    </div>
  </Modal>
</template>
