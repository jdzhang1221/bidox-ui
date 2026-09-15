<script lang="ts" setup>
import { computed, ref } from 'vue';

import { Button } from 'ant-design-vue';

/**
 * 输入框
 *
 * 中文输入法是这里唯一真正的难点：拼音候选阶段按回车是「上屏候选词」，
 * 不是「发送」。只判 `event.key === 'Enter'` 会把用户的半个词发出去。
 *
 * 两道防线（都要，缺一不可）：
 * - `isComposing`（`KeyboardEvent` 属性）：Safari 上 `compositionend` 早于 `keydown` 派发，
 *   只看 `isComposing` 会漏；
 * - `composing`（`compositionstart/end` 维护的本地状态）：Chrome 上 `keydown` 的
 *   `isComposing` 为 `false` 但 `compositionend` 还没到，只看 `isComposing` 会误发。
 *
 * 两者取「或」，任一为真就不发送。
 */
const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    /** 知识库未选/无可用库时的额外禁用原因，展示在输入框下方 */
    disabledReason?: string;
    /** 是否正在生成（决定「发送」按钮是否变成「停止」） */
    generating?: boolean;
    placeholder?: string;
  }>(),
  {
    disabled: false,
    disabledReason: '',
    generating: false,
    placeholder: '输入你的问题，Enter 发送，Shift+Enter 换行',
  },
);

const emit = defineEmits<{
  send: [text: string];
  stop: [];
}>();

const text = ref('');
/** 输入法组合状态。见上方注释：必须与 `isComposing` 一起判断 */
const composing = ref(false);
const inputRef = ref<HTMLTextAreaElement>();

const canSend = computed(
  () => !props.disabled && !props.generating && text.value.trim() !== '',
);

function handleCompositionStart(): void {
  composing.value = true;
}

function handleCompositionEnd(): void {
  composing.value = false;
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter') {
    return;
  }
  // Shift+Enter 换行
  if (event.shiftKey) {
    return;
  }
  if (composing.value || event.isComposing) {
    // 正在上屏候选词：把这次回车交给输入法
    return;
  }
  event.preventDefault();
  submit();
}

function submit(): void {
  const value = text.value.trim();
  if (!value || props.disabled || props.generating) {
    return;
  }
  emit('send', value);
  text.value = '';
}

/** 供父组件在外部设置文本（例如点击推荐问题） */
function setText(value: string): void {
  text.value = value;
}

/** 供父组件在外部聚焦输入框。与 `setText` 配对使用：只填文本不聚焦，用户还得再点一次 */
function focus(): void {
  inputRef.value?.focus();
}

defineExpose({ focus, setText });
</script>

<template>
  <div class="qa-composer">
    <div class="qa-composer__box">
      <textarea
        ref="inputRef"
        v-model="text"
        class="qa-composer__input"
        :disabled="disabled"
        :placeholder="placeholder"
        rows="3"
        @compositionend="handleCompositionEnd"
        @compositionstart="handleCompositionStart"
        @keydown="handleKeydown"
      ></textarea>
      <div class="qa-composer__actions">
        <Button v-if="generating" danger @click="emit('stop')">停止生成</Button>
        <Button v-else :disabled="!canSend" type="primary" @click="submit">
          发送
        </Button>
      </div>
    </div>
    <p v-if="disabledReason" class="qa-composer__hint">{{ disabledReason }}</p>
  </div>
</template>

<style scoped>
.qa-composer {
  padding: 10px 16px 14px;
  border-top: 1px solid hsl(var(--border));
}

.qa-composer__box {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 8px 8px 8px 12px;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 10px;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

/* 聚焦反馈挂在容器上：textarea 自己已经去掉了 outline */
.qa-composer__box:focus-within {
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 3px hsl(var(--primary) / 10%);
}

.qa-composer__input {
  flex: 1;
  min-height: 56px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.6;
  color: hsl(var(--foreground));
  resize: vertical;
  outline: none;
  background: transparent;
  border: none;
}

.qa-composer__input::placeholder {
  color: hsl(var(--input-placeholder));
}

.qa-composer__input:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.qa-composer__actions {
  flex-shrink: 0;
}

.qa-composer__hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: hsl(var(--destructive));
}
</style>
