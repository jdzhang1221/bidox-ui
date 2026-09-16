<script lang="ts" setup>
import type { ChatMessage } from './types';

import type { BidKnowledgeQaApi } from '#/api/bid/knowledge-qa';

import { computed, nextTick, onActivated, onDeactivated, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Alert, Button, Select, Spin, Tag } from 'antdv-next';

import { createUuid } from '#/api/auth-session';
import {
  getKnowledgeBaseOptions,
  getMessageList,
} from '#/api/bid/knowledge-qa';

import ChatComposer from './components/chat-composer.vue';
import ConversationList from './components/conversation-list.vue';
import MessageList from './components/message-list.vue';
import { useChatScroll } from './composables/use-chat-scroll';
import { useKnowledgeQaStream } from './composables/use-knowledge-qa-stream';
import { createMessageKey, toChatMessage } from './types';

/**
 * 企业知识问答（§5.10）
 *
 * 页面只做三件事：持有「当前会话 + 消息列表 + 知识库选择」，把 SSE 的时序问题
 * 全部交给 `use-knowledge-qa-stream`，把滚动锚点交给 `use-chat-scroll`。
 */

const MESSAGE_PAGE_SIZE = 30;

// ==================== 状态 ====================

const conversationId = ref<null | number>(null);
const messages = ref<ChatMessage[]>([]);
const loadingHistory = ref(false);
const hasMoreHistory = ref(false);
/** 已加载的最早一条服务端消息编号，作为 `beforeMessageId` 游标 */
const oldestMessageId = ref<null | number>(null);
/** 会话列表刷新信号（自增即触发子组件重新拉取） */
const conversationReloadToken = ref(0);

const kbOptions = ref<BidKnowledgeQaApi.KnowledgeBaseOption[]>([]);
/** `loading / ready / empty / error` 四态必须区分，不能都退化成「可用」 */
const kbState = ref<'empty' | 'error' | 'loading' | 'ready'>('loading');
const kbError = ref('');
/** 选择值用字符串哨兵：`'all'` 表示不限定知识库 */
const kbSelection = ref('all');

const scrollRef = ref<HTMLElement>();
const composerRef = ref<InstanceType<typeof ChatComposer>>();

/**
 * 空态推荐问题。
 *
 * 知识库问答的提问方式与普通搜索不同（要问「文档里写了什么」，而不是问「是什么」），
 * 直接给几个「基于已入库文档可回答」的样例，比一句功能说明更能降低上手成本。
 */
const SUGGESTIONS = [
  '投标保证金的比例上限是多少？依据在哪个文件里？',
  '技术标的评分标准包含哪些维度？',
  '对类似项目的业绩要求是什么？',
];

/** 点推荐问题 → 填入输入框并聚焦，用户只需再按一次回车 */
function applySuggestion(question: string): void {
  composerRef.value?.setText(question);
  composerRef.value?.focus();
}

/**
 * 当前正在流式写入的消息键。
 *
 * 刻意用普通 `let` 而不是 `ref`：它只在事件回调里被读取，
 * 进响应式系统只会多一层代理开销。
 */
let activeAssistantKey: null | string = null;
let activeUserKey: null | string = null;
/** 当前流所属会话，用于上下文校验 */
let streamConversationId: null | number = null;
/** clientRequestId → 消息键。对账是异步的，必须按请求身份定位消息 */
const keyByRequest = new Map<string, string>();

const {
  followIfNearBottom,
  beginHistoryLoad,
  endHistoryLoad,
  isLoadingHistory,
  onScroll,
  scrollToBottom,
} = useChatScroll(scrollRef);

const stream = useKnowledgeQaStream({
  // 会话切换时我们会显式 invalidate()，这里再校验一次「流所属会话仍是当前会话」。
  // 两道防线的理由：invalidate 覆盖的是「我们知道的切换」，而这里覆盖的是
  // 「meta 回填会话编号」这类只有流自己知道的状态变化。
  isContextCurrent: () => streamConversationId === conversationId.value,

  onContent(content) {
    const message = findMessage(activeAssistantKey);
    if (!message) {
      return;
    }
    message.content = content;
    followIfNearBottom();
  },

  onMeta(meta) {
    const assistant = findMessage(activeAssistantKey);
    if (assistant) {
      assistant.id = meta.messageId;
    }
    const user = findMessage(activeUserKey);
    if (user) {
      user.id = meta.userMessageId;
    }
    // 首问：服务端在这里才把会话创建出来
    if (conversationId.value === null) {
      conversationId.value = meta.conversationId;
      streamConversationId = meta.conversationId;
      reloadConversations();
    }
  },

  onReconciled(status, clientRequestId) {
    // 必须按 clientRequestId 定位：对账期间用户可能已经问了下一个问题
    const key = keyByRequest.get(clientRequestId);
    const message = key ? findMessage(key) : undefined;
    if (!message) {
      return;
    }
    message.status = status.status;
    message.errorCode = status.errorCode;
    message.errorMessage = status.errorMessage;
    message.finishReason = status.finishReason;
    if (
      message.id === null &&
      status.messageId !== undefined &&
      status.messageId !== null
    ) {
      message.id = status.messageId;
    }
  },

  onSources(sources) {
    const message = findMessage(activeAssistantKey);
    if (message) {
      message.sources = sources;
    }
  },

  onTerminal(terminal) {
    const message = findMessage(activeAssistantKey);
    if (message) {
      if (terminal.messageId !== undefined && terminal.messageId !== null) {
        message.id = terminal.messageId;
      }
      message.errorCode = terminal.errorCode;
      message.errorMessage = terminal.errorMessage;
      message.finishReason = terminal.finishReason;
      switch (terminal.phase) {
        case 'completed': {
          message.status = 1;
          break;
        }
        case 'failed': {
          message.status = 2;
          break;
        }
        case 'stopped': {
          message.status = 3;
          break;
        }
        default: {
          // unknown：保持 GENERATING，由对账修正；不猜终态
          break;
        }
      }
    }
    followIfNearBottom();
    // 终态会改变会话的最后消息时间，进而改变排序
    reloadConversations();
  },
});

const streaming = computed(
  () =>
    stream.phase.value === 'connecting' || stream.phase.value === 'generating',
);

const knowledgeBaseId = computed<null | number>(() =>
  kbSelection.value === 'all' ? null : Number(kbSelection.value),
);

const kbSelectOptions = computed(() => [
  { label: '全部知识库', value: 'all' },
  ...kbOptions.value.map((option) => ({
    label: option.name,
    value: String(option.id),
  })),
]);

/** 输入框的禁用原因。只有 `ready` 才允许提问 */
const composerDisabledReason = computed(() => {
  switch (kbState.value) {
    case 'empty': {
      return '当前租户没有启用中的知识库，无法提问';
    }
    case 'error': {
      return '知识库列表加载失败，请重试后再提问';
    }
    case 'loading': {
      return '正在加载知识库…';
    }
    default: {
      return '';
    }
  }
});

// ==================== 知识库选项 ====================

async function loadKnowledgeBaseOptions(): Promise<void> {
  kbState.value = 'loading';
  kbError.value = '';
  try {
    const list = await getKnowledgeBaseOptions();
    kbOptions.value = list ?? [];
    if (kbOptions.value.length === 0) {
      // 空列表 ≠ 失败：这是「租户确实没有启用中的库」，文案与处置都不同。
      // 两者都**不能**退化成「不限知识库」—— 那会让用户在以为有依据的情况下拿到全库答案。
      kbState.value = 'empty';
      kbSelection.value = 'all';
    } else {
      kbState.value = 'ready';
    }
  } catch (error) {
    kbState.value = 'error';
    kbError.value = error instanceof Error ? error.message : '加载失败';
  }
}

// ==================== 会话 ====================

function reloadConversations(): void {
  conversationReloadToken.value += 1;
}

/** 切到某个历史会话 */
async function selectConversation(id: number): Promise<void> {
  if (conversationId.value === id && messages.value.length > 0) {
    return;
  }
  // 先让旧流失效，再换上下文 —— 反过来会有一个窗口让旧流的事件写进新会话
  stream.invalidate();
  conversationId.value = id;
  streamConversationId = id;
  activeAssistantKey = null;
  activeUserKey = null;
  messages.value = [];
  oldestMessageId.value = null;
  hasMoreHistory.value = false;
  await loadMessages(true);
}

/** 新对话：只清本地状态，会话由服务端的首问创建 */
function newConversation(): void {
  stream.invalidate();
  conversationId.value = null;
  streamConversationId = null;
  activeAssistantKey = null;
  activeUserKey = null;
  messages.value = [];
  oldestMessageId.value = null;
  hasMoreHistory.value = false;
  scrollToBottom('auto');
}

/** 会话被删除：若删的是当前会话，回到新对话状态 */
function handleConversationRemoved(id: number): void {
  if (conversationId.value === id) {
    newConversation();
  }
}

// ==================== 消息 ====================

async function loadMessages(reset: boolean): Promise<void> {
  const currentConversationId = conversationId.value;
  if (currentConversationId === null) {
    return;
  }
  // 加载历史期间必须挂起底部跟随，否则「补偿锚点」和「跟随到底」会互相打架
  const anchor = reset ? null : beginHistoryLoad();
  loadingHistory.value = true;
  try {
    const list = await getMessageList({
      beforeMessageId: reset ? undefined : (oldestMessageId.value ?? undefined),
      conversationId: currentConversationId,
      limit: MESSAGE_PAGE_SIZE,
    });
    // 服务端按 id 倒序返回，反转后才是时间正序
    const ordered = (list ?? [])
      .toReversed()
      .map((item) => toChatMessage(item));
    if (reset) {
      messages.value = ordered;
      await nextTick();
      scrollToBottom('auto');
    } else {
      messages.value = [...ordered, ...messages.value];
      await nextTick();
      endHistoryLoad(anchor);
    }
    hasMoreHistory.value = (list?.length ?? 0) >= MESSAGE_PAGE_SIZE;
    oldestMessageId.value =
      messages.value.find((message) => message.id !== null)?.id ?? null;
  } catch {
    if (!reset) {
      endHistoryLoad(anchor);
    }
  } finally {
    loadingHistory.value = false;
  }
}

function handleLoadMore(): void {
  void loadMessages(false);
}

function findMessage(key: null | string): ChatMessage | undefined {
  if (!key) {
    return undefined;
  }
  return messages.value.find((message) => message.key === key);
}

// ==================== 发送 ====================

async function handleSend(question: string): Promise<void> {
  if (kbState.value !== 'ready') {
    return;
  }
  const clientRequestId = createUuid();
  const userKey = createMessageKey();
  const assistantKey = createMessageKey();

  activeUserKey = userKey;
  activeAssistantKey = assistantKey;
  streamConversationId = conversationId.value;
  keyByRequest.set(clientRequestId, assistantKey);

  messages.value.push(
    {
      content: question,
      id: null,
      key: userKey,
      role: 'user',
      // user 行一旦落库就是完整的，恒为已完成
      status: 1,
    },
    {
      content: '',
      id: null,
      key: assistantKey,
      role: 'assistant',
      sources: [],
      status: 0,
    },
  );

  await nextTick();
  scrollToBottom('smooth');

  await stream.start({
    clientRequestId,
    conversationId: conversationId.value,
    knowledgeBaseId: knowledgeBaseId.value,
    question,
  });
}

// ==================== 生命周期 ====================

// KeepAlive 失活：立即终止旧流。不这么做的话，用户在别处切租户时，
// 这条流仍会把旧租户的答案写回来。
onDeactivated(() => {
  stream.invalidate();
});

// 重新激活：服务端状态可能已经变了（流被容器回收、reaper 收敛），以服务端为准
onActivated(() => {
  if (conversationId.value !== null) {
    void loadMessages(true);
  }
});

loadKnowledgeBaseOptions();
</script>

<template>
  <Page auto-content-height>
    <div class="qa-page">
      <!-- 左：会话列表 -->
      <aside class="qa-page__aside">
        <ConversationList
          :active-id="conversationId"
          :reload-token="conversationReloadToken"
          @create="newConversation"
          @removed="handleConversationRemoved"
          @select="selectConversation"
        />
      </aside>

      <!-- 右：对话区 -->
      <section class="qa-page__main">
        <header class="qa-page__toolbar">
          <Select
            v-model:value="kbSelection"
            :disabled="kbState !== 'ready'"
            :options="kbSelectOptions"
            class="qa-page__kb"
          />
          <Spin v-if="kbState === 'loading'" size="small" />
          <Tag v-else-if="kbState === 'empty'" color="warning">
            无可用知识库
          </Tag>
          <template v-else-if="kbState === 'error'">
            <Tag color="error">知识库加载失败</Tag>
            <Button size="small" type="link" @click="loadKnowledgeBaseOptions">
              重试
            </Button>
          </template>
          <span v-if="streaming" class="qa-page__phase">
            <span class="qa-page__phase-dot"></span>
            生成中…
          </span>
        </header>

        <Alert
          v-if="kbState === 'error'"
          :message="`知识库列表加载失败：${kbError}`"
          class="qa-page__alert"
          show-icon
          type="error"
        />

        <div ref="scrollRef" class="qa-page__scroll" @scroll.passive="onScroll">
          <MessageList
            v-if="messages.length > 0"
            :has-more="hasMoreHistory"
            :loading-history="isLoadingHistory || loadingHistory"
            :messages="messages"
            :streaming="streaming"
            @load-more="handleLoadMore"
          />
          <div v-else class="qa-page__welcome">
            <div class="qa-page__welcome-mark">AI</div>
            <h3>企业知识问答</h3>
            <p>
              基于已解析入库的历史标书与招标文件作答，答案会附带可追溯的引用来源。
            </p>
            <!-- 知识库未就绪时不给样例：点了也发不出去，只会让人以为坏了 -->
            <div v-if="kbState === 'ready'" class="qa-page__suggestions">
              <button
                v-for="question in SUGGESTIONS"
                :key="question"
                class="qa-page__suggestion"
                type="button"
                @click="applySuggestion(question)"
              >
                {{ question }}
              </button>
            </div>
          </div>
        </div>

        <ChatComposer
          ref="composerRef"
          :disabled="kbState !== 'ready'"
          :disabled-reason="composerDisabledReason"
          :generating="streaming"
          @send="handleSend"
          @stop="stream.stop"
        />
      </section>
    </div>
  </Page>
</template>

<style scoped>
.qa-page {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.qa-page__aside {
  flex: 0 0 240px;
  height: 100%;
  overflow: hidden;
}

.qa-page__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  height: 100%;
}

.qa-page__toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid hsl(var(--border));
}

.qa-page__kb {
  width: 220px;
}

.qa-page__phase {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}

.qa-page__phase-dot {
  width: 6px;
  height: 6px;
  background: hsl(var(--primary));
  border-radius: 50%;
  animation: qa-phase-pulse 1.2s ease-in-out infinite;
}

@keyframes qa-phase-pulse {
  0%,
  100% {
    opacity: 0.3;
  }

  50% {
    opacity: 1;
  }
}

.qa-page__alert {
  margin: 8px 16px 0;
}

.qa-page__scroll {
  flex: 1;
  overflow-y: auto;
}

.qa-page__welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 48px 24px;
  text-align: center;
}

.qa-page__welcome-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-bottom: 14px;
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 10%);
  border: 1px solid hsl(var(--primary) / 25%);
  border-radius: 50%;
}

.qa-page__welcome h3 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.qa-page__welcome p {
  max-width: 420px;
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: hsl(var(--muted-foreground));
}

.qa-page__suggestions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 420px;
  margin-top: 24px;
}

.qa-page__suggestion {
  padding: 9px 14px;
  font-size: 13px;
  line-height: 1.6;
  color: hsl(var(--foreground));
  text-align: left;
  cursor: pointer;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
}

.qa-page__suggestion:hover {
  background: hsl(var(--primary) / 5%);
  border-color: hsl(var(--primary));
}
</style>
