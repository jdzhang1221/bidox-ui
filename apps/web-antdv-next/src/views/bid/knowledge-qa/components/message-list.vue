<script lang="ts" setup>
import type { CitedSourceView } from '../citation';
import type { ChatMessage } from '../types';

import { computed, ref } from 'vue';

import { MarkdownView } from '#/components/markdown-view';

import { resolveCitedSources } from '../citation';
import SourceList from './source-list.vue';

/**
 * 消息列表
 *
 * 渲染上只有一条硬规则：**用户消息按纯文本、助手消息按 Markdown**。
 *
 * 用户问题原样回显即可（它本来就是用户自己敲的）；助手答案需要 Markdown
 * 才能呈现表格与代码块，而 `MarkdownView` 内部已经收口了安全策略
 * （禁原始 HTML、链接协议白名单）。引用片段则反过来 —— 它是上游文档原文，
 * 走纯文本，见 `source-list.vue`。
 */
const props = withDefaults(
  defineProps<{
    /** 是否还有更早的历史 */
    hasMore?: boolean;
    /** 是否正在加载更早的历史 */
    loadingHistory?: boolean;
    messages: ChatMessage[];
    /**
     * 当前是否真的在流式生成。
     *
     * 不能只看 `status === 0`：对账前 `unknown` 相位下消息仍是 GENERATING，
     * 但连接已经断了，再转「正在生成」的点点点就是在骗用户。
     */
    streaming?: boolean;
  }>(),
  { hasMore: false, loadingHistory: false, streaming: false },
);

const emit = defineEmits<{ loadMore: [] }>();

/**
 * 每条助手消息「实际被引用的来源」。
 *
 * 用 `computed` 一次算完整张表，而不是在模板里逐条调用函数：
 * 模板函数会在**每次渲染**时对每条消息重跑正则（流式期间每 75ms 一次），
 * 而 `computed` 只在 `messages` 变化时重算一次。
 */
const sourceViewByKey = computed(() => {
  const map = new Map<string, CitedSourceView>();
  for (const message of props.messages) {
    if (message.role === 'assistant') {
      map.set(
        message.key,
        resolveCitedSources(message.content, message.sources),
      );
    }
  }
  return map;
});

function sourceEntries(message: ChatMessage) {
  return sourceViewByKey.value.get(message.key)?.entries ?? [];
}

function recalledCountOf(message: ChatMessage): number {
  return sourceViewByKey.value.get(message.key)?.recalledCount ?? 0;
}

/**
 * 该消息的来源是否**真的**按引用收敛过。
 *
 * `false` = 答案正文没有任何 `[来源N]`，`sourceEntries` 是全量兜底。
 * 必须透传给 SourceList 换文案，否则「未找到依据」的回答也会写「引用来源 6 条」。
 */
function isSourceFiltered(message: ChatMessage): boolean {
  return sourceViewByKey.value.get(message.key)?.filtered ?? true;
}

/** 助手行仍是 GENERATING */
function isPending(message: ChatMessage): boolean {
  return message.role === 'assistant' && message.status === 0;
}

function isFailed(message: ChatMessage): boolean {
  return message.role === 'assistant' && message.status === 2;
}

function isCancelled(message: ChatMessage): boolean {
  return message.role === 'assistant' && message.status === 3;
}

/**
 * 「只有状态说明、没有正文」的气泡。
 *
 * 气泡默认 `flex: 1` 撑满整行 —— 对 Markdown 正文是对的，但对
 * 「已停止生成」这 5 个字，会画出一个 1000px 宽、里面只有一行小字的空框。
 * 这类气泡改为按内容收缩。
 *
 * 两个例外必须保持整行宽：
 * - 失败态：红色告警框要占满才醒目；
 * - 带来源列表：`SourceList` 内部是列表 + 卡片，被挤到几百像素会散架。
 */
function isNoteOnly(message: ChatMessage): boolean {
  return (
    message.role === 'assistant' &&
    !message.content &&
    !isFailed(message) &&
    sourceEntries(message).length === 0
  );
}

function failedText(message: ChatMessage): string {
  return message.errorMessage || '回答生成失败，请稍后重试';
}

/**
 * 当前被正文角标点亮的来源。
 *
 * 必须带上 `message.key`：消息由 `v-for` 渲染，没有 key 就分不清
 * 「这条消息的第 2 条来源」和「那条消息的第 2 条来源」，一点就会串台。
 */
const activeSource = ref<null | { index: number; key: string }>(null);

/** 正文角标被点击 → 转交给对应消息的 SourceList 去展开并定位 */
function handleSourceClick(message: ChatMessage, index: number): void {
  activeSource.value = { index, key: message.key };
}

/** 该消息当前要高亮的来源编号；不属于这条消息则返回 undefined */
function activeIndexFor(message: ChatMessage): number | undefined {
  return activeSource.value?.key === message.key
    ? activeSource.value.index
    : undefined;
}
</script>

<template>
  <div class="qa-messages">
    <div v-if="hasMore || loadingHistory" class="qa-messages__more">
      <button
        class="qa-messages__more-btn"
        :disabled="loadingHistory"
        type="button"
        @click="emit('loadMore')"
      >
        {{ loadingHistory ? '加载中…' : '加载更早的消息' }}
      </button>
    </div>

    <div
      v-for="message in messages"
      :key="message.key"
      class="qa-message"
      :class="`qa-message--${message.role}`"
      :data-message-key="message.key"
    >
      <!-- 助手侧头像：让「谁在说」在长对话里一眼可辨 -->
      <div v-if="message.role === 'assistant'" class="qa-message__avatar">
        AI
      </div>

      <div
        class="qa-message__bubble"
        :class="{
          'is-error': isFailed(message),
          'is-note': isNoteOnly(message),
        }"
      >
        <!-- 用户消息：纯文本回显 -->
        <p v-if="message.role === 'user'" class="qa-message__plain">
          {{ message.content }}
        </p>

        <!-- 助手消息 -->
        <template v-else>
          <!--
            `source-count` 必须传**原始召回总数**，不能传收敛后的条数：
            正文角标 `[来源N]` 的 N 是原始证据编号，越界判断只能按原始总数做。
            传收敛后的条数会把「合法但未被引用」的角标误判成越界、降级成纯文本。
          -->
          <MarkdownView
            v-if="message.content"
            :content="message.content"
            :source-count="message.sources?.length ?? 0"
            @source-click="handleSourceClick(message, $event)"
          />

          <div
            v-else-if="isPending(message) && streaming"
            class="qa-message__typing"
            aria-label="正在生成"
          >
            <span></span><span></span><span></span>
          </div>

          <div v-else-if="isCancelled(message)" class="qa-message__note">
            已停止生成
          </div>

          <div v-else-if="isFailed(message)" class="qa-message__error">
            {{ failedText(message) }}
            <span v-if="message.errorCode" class="qa-message__error-code">
              （{{ message.errorCode }}）
            </span>
          </div>

          <div v-else-if="isPending(message)" class="qa-message__note">
            连接已断开，状态待确认…
          </div>

          <!-- 生成中且还没有正文时也展示来源，让用户先看到「依据是什么」 -->
          <SourceList
            v-if="sourceEntries(message).length > 0"
            :active-index="activeIndexFor(message)"
            :entries="sourceEntries(message)"
            :filtered="isSourceFiltered(message)"
            :recalled-count="recalledCountOf(message)"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qa-messages {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px 16px;
}

.qa-messages__more {
  text-align: center;
}

.qa-messages__more-btn {
  padding: 4px 12px;
  font-size: 12px;
  color: hsl(var(--primary));
  cursor: pointer;
  background: transparent;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
}

.qa-messages__more-btn:disabled {
  cursor: default;
  opacity: 0.6;
}

.qa-message {
  display: flex;
  gap: 10px;
}

.qa-message--user {
  justify-content: flex-end;
}

.qa-message--assistant {
  justify-content: flex-start;
}

.qa-message__avatar {
  display: flex;
  flex: 0 0 26px;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-top: 2px;
  font-size: 11px;
  font-weight: 600;
  color: hsl(var(--primary));
  user-select: none;
  background: hsl(var(--primary) / 10%);
  border: 1px solid hsl(var(--primary) / 25%);
  border-radius: 50%;
}

.qa-message__bubble {
  padding: 10px 14px;
  border-radius: 10px;
}

/**
 * 用户气泡：主题主色 + 反色文字，任何主题下对比度都由主题保证。
 */
.qa-message--user .qa-message__bubble {
  max-width: 88%;
  color: hsl(var(--primary-foreground));
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  background: hsl(var(--primary));
  border-radius: 12px 12px 2px;
}

/**
 * 助手气泡：**用 `--muted` 而不是 `--card`**。
 *
 * 原先用 `--card`，而对话区背景本身就是 `--background`（浅色主题下两者都是纯白、
 * 暗色主题下两者都接近纯黑），气泡与背景几乎融为一体，只靠一圈 1px 边框分隔。
 * `--muted` 在两个主题下都与页面底色有明显层次差。
 */
.qa-message--assistant .qa-message__bubble {
  flex: 1;
  min-width: 0;
  background: hsl(var(--muted));
  border-radius: 2px 12px 12px;
}

/* 失败的回答给一层可辨识的底，避免和正常回答混在一起 */
.qa-message--assistant .qa-message__bubble.is-error {
  background: hsl(var(--destructive) / 8%);
  border: 1px solid hsl(var(--destructive) / 30%);
}

/**
 * 只有状态说明（「已停止生成」/「连接已断开」/ 生成中的点点点）时按内容收缩，
 * 不要画一个整行宽的空框。见 `isNoteOnly` 的两个例外。
 */
.qa-message--assistant .qa-message__bubble.is-note {
  flex: 0 1 auto;
}

.qa-message__plain {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
}

.qa-message__note {
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}

.qa-message__error {
  font-size: 13px;
  color: hsl(var(--destructive));
}

.qa-message__error-code {
  color: hsl(var(--muted-foreground));
}

.qa-message__typing {
  display: inline-flex;
  gap: 4px;
  padding: 4px 0;
}

.qa-message__typing span {
  width: 6px;
  height: 6px;
  background: hsl(var(--muted-foreground));
  border-radius: 50%;
  animation: qa-typing 1.2s infinite ease-in-out;
}

.qa-message__typing span:nth-child(2) {
  animation-delay: 0.15s;
}

.qa-message__typing span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes qa-typing {
  0%,
  60%,
  100% {
    opacity: 0.25;
    transform: translateY(0);
  }

  30% {
    opacity: 1;
    transform: translateY(-3px);
  }
}
</style>
