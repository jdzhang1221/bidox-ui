<script lang="ts" setup>
import { $t } from '@vben/locales';
import { openWindow } from '@vben/utils';

import { useVbenModal } from '@vben-core/popup-ui';
import { Badge, VbenButton, VbenButtonGroup } from '@vben-core/shadcn-ui';

import { useMagicKeys, whenever } from '@vueuse/core';

defineOptions({
  name: 'Help',
});

const keys = useMagicKeys();
whenever(keys['Alt+KeyH']!, () => {
  modalApi.open();
});

const [Modal, modalApi] = useVbenModal({
  draggable: true,
  overlayBlur: 5,
  footer: false,
  onCancel() {
    modalApi.close();
  },
});
</script>
<template>
  <Modal class="w-1/3" :title="$t('ui.widgets.qa')">
    <div class="mt-2 flex flex-col">
      <div class="mt-2 flex flex-col">
        <VbenButtonGroup class="basis-1/3" :gap="2" border size="large">
          <p class="w-24 p-2">项目地址:</p>
          <VbenButton
            variant="link"
            @click="openWindow('https://github.com/jdzhang1221/bidox-ui')"
          >
            Github
          </VbenButton>
        </VbenButtonGroup>

        <VbenButtonGroup class="basis-1/3" :gap="2" border size="large">
          <p class="w-24 p-2">issues:</p>
          <VbenButton
            variant="link"
            @click="
              openWindow('https://github.com/jdzhang1221/bidox-ui/issues')
            "
          >
            Github
          </VbenButton>
        </VbenButtonGroup>

        <VbenButtonGroup class="basis-1/3" :gap="2" border size="large">
          <p class="w-24 p-2">开发文档:</p>
          <VbenButton
            variant="link"
            @click="openWindow('https://doc.vben.pro/')"
          >
            Vben 文档
          </VbenButton>
          <VbenButton variant="link" @click="openWindow('https://antdv.com/')">
            antdv 文档
          </VbenButton>
        </VbenButtonGroup>
      </div>

      <p class="mt-2 flex justify-center pt-4 text-sm italic">
        基于 <Badge class="mx-2" variant="destructive">MIT</Badge>
        开源协议构建
      </p>
    </div>
  </Modal>
</template>
