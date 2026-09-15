<script lang="ts" setup>
import type { CitedSourceEntry } from '../citation';

import type { BidKnowledgeQaApi } from '#/api/bid/knowledge-qa';

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

import { toPlainTextHtml } from '#/components/markdown-view';

/**
 * 引用来源列表
 *
 * 三个不能含糊的点：
 *
 * 1. **片段按纯文本渲染**。snippet 来自「上游文档原文」，是不可信内容，
 *    走 `toPlainTextHtml` 转义后注入，绝不交给 Markdown 渲染器
 *    （那会放行 `[x](javascript:...)` 之类的构造）。
 * 2. **排序分与相似度分开展示**。`similarity` 是向量相似度，keyword-only 命中时为 `null`；
 *    `retrievalScore` 才是融合/重排后的排序分。把后者当相似度展示，
 *    用户看到的 0.94 其实和语义相似度无关，会直接误导对答案可信度的判断。
 * 3. **编号取 `entry.index`，不是数组下标**。列表只展示**被答案引用**的来源，
 *    所以编号可能是「2、4」这种不连续的原始证据编号。
 *    用下标编号会让正文 `[来源4]` 指向另一条 —— 收敛与定位必须共用同一套编号。
 */
const props = withDefaults(
  defineProps<{
    /**
     * 要高亮并滚动定位的来源编号（**原始证据编号**，1 起），由正文角标点击驱动。
     *
     * 用受控 prop 而不是暴露 `reveal()` 方法：消息列表是 `v-for` 渲染的，
     * 用模板 ref 收集子组件实例既要处理类型断言，又要在卸载时逐个清理，
     * 受控 prop 天然没有这些问题。
     */
    activeIndex?: number;
    defaultExpanded?: boolean;
    /** 要展示的条目（已按「被引用」收敛，带原始编号） */
    entries?: CitedSourceEntry[];
    /** 本轮检索召回的条数，用于说明「为什么不是全部」 */
    recalledCount?: number;
  }>(),
  {
    activeIndex: undefined,
    defaultExpanded: false,
    entries: () => [],
    recalledCount: 0,
  },
);

const rootRef = ref<HTMLElement>();
const expanded = ref(props.defaultExpanded);
/** 正在闪烁高亮的编号；约 1.6 秒后清空 */
const highlightIndex = ref<null | number>(null);

let highlightTimer: null | ReturnType<typeof setTimeout> = null;

const items = computed(() => props.entries ?? []);

/**
 * 是否发生了收敛（隐藏了未被引用的来源）。
 *
 * 只在「确有隐藏」时提示，否则「召回 N 条」会和标题重复。
 */
const hasHidden = computed(() => props.recalledCount > items.value.length);

function displayName(source: BidKnowledgeQaApi.Source): string {
  if (source.documentName) {
    return source.documentName;
  }
  return source.documentId === undefined || source.documentId === null
    ? '未知文档'
    : `文档 #${source.documentId}`;
}

function pageLabel(source: BidKnowledgeQaApi.Source): string {
  const { pageEnd, pageStart } = source;
  if (
    (pageStart === undefined || pageStart === null) &&
    (pageEnd === undefined || pageEnd === null)
  ) {
    return '';
  }
  if (
    pageStart !== undefined &&
    pageStart !== null &&
    pageEnd !== undefined &&
    pageEnd !== null &&
    pageStart !== pageEnd
  ) {
    return `P${pageStart}–P${pageEnd}`;
  }
  return `P${pageStart ?? pageEnd}`;
}

/**
 * 主分数：优先排序分，退回相似度。
 *
 * 列表里只显示一个值，普通用户才能一眼扫过；完整维度放进 `title` 供核对。
 */
function primaryScoreLabel(source: BidKnowledgeQaApi.Source): string {
  if (typeof source.retrievalScore === 'number') {
    return `排序分 ${source.retrievalScore.toFixed(3)}`;
  }
  if (typeof source.similarity === 'number') {
    return `相似度 ${source.similarity.toFixed(3)}`;
  }
  return '';
}

/** 完整分数串。`scoreType` 一并展示，避免读者把 rrf 分当成概率 */
function fullScoreLabel(source: BidKnowledgeQaApi.Source): string {
  const parts: string[] = [];
  if (typeof source.retrievalScore === 'number') {
    parts.push(`排序分 ${source.retrievalScore.toFixed(3)}`);
  }
  if (typeof source.similarity === 'number') {
    parts.push(`相似度 ${source.similarity.toFixed(3)}`);
  }
  if (source.scoreType) {
    parts.push(`评分方式 ${source.scoreType}`);
  }
  return parts.join(' · ');
}

/**
 * 展开列表 + 滚动到编号为 N 的那条 + 高亮。
 *
 * **按 `data-source-index` 属性定位，不能用 `querySelectorAll(...)[index - 1]`**：
 * 列表已按「被引用」收敛，编号可能是不连续的「2、4」，
 * 下标与编号不再是一一对应，用下标定位会跳到另一条来源上。
 *
 * 用根元素 `querySelector` 而不是 `v-for` 的函数 ref 数组：
 * 后者的元素类型是 `Element | ComponentPublicInstance | null`，
 * 要写一串类型守卫才能拿到 `scrollIntoView`，收益不抵成本。
 *
 * `ol` 用的是 `v-show`（不是 `v-if`），条目始终在 DOM 里，展开后立刻就能滚到。
 */
async function reveal(index: number): Promise<void> {
  expanded.value = true;
  await nextTick();

  const target = rootRef.value?.querySelector<HTMLElement>(
    `.qa-sources__item[data-source-index="${index}"]`,
  );
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  highlightIndex.value = index;
  if (highlightTimer !== null) {
    clearTimeout(highlightTimer);
  }
  highlightTimer = setTimeout(() => {
    highlightIndex.value = null;
    highlightTimer = null;
  }, 1600);
}

watch(
  () => props.activeIndex,
  (index) => {
    if (typeof index === 'number' && index > 0) {
      void reveal(index);
    }
  },
);

onBeforeUnmount(() => {
  if (highlightTimer !== null) {
    clearTimeout(highlightTimer);
  }
});
</script>

<template>
  <div v-if="items.length > 0" ref="rootRef" class="qa-sources">
    <button
      class="qa-sources__toggle"
      type="button"
      @click="expanded = !expanded"
    >
      <span class="qa-sources__caret">{{ expanded ? '▾' : '▸' }}</span>
      引用来源 {{ items.length }} 条
    </button>
    <!-- 说明「为什么不是全部」，避免用户以为来源丢了 -->
    <span v-if="hasHidden" class="qa-sources__recalled">
      （检索召回 {{ recalledCount }} 条，仅显示被答案引用的）
    </span>
    <ol v-show="expanded" class="qa-sources__list">
      <li
        v-for="entry in items"
        :key="entry.source.chunkId ?? `idx-${entry.index}`"
        class="qa-sources__item"
        :class="{ 'is-highlight': highlightIndex === entry.index }"
        :data-source-index="entry.index"
      >
        <div class="qa-sources__head">
          <!-- 编号与正文角标同款，用户扫一眼就能把「来源N」对上 -->
          <span class="qa-sources__index">{{ entry.index }}</span>
          <span class="qa-sources__doc">
            {{ displayName(entry.source) }}
          </span>
          <span v-if="pageLabel(entry.source)" class="qa-sources__page">
            {{ pageLabel(entry.source) }}
          </span>
          <span
            v-if="primaryScoreLabel(entry.source)"
            class="qa-sources__score"
            :title="fullScoreLabel(entry.source)"
          >
            {{ primaryScoreLabel(entry.source) }}
          </span>
        </div>
        <!--
          snippet 走 `toPlainTextHtml` 转义后再 v-html：它是上游文档原文，属不可信内容。
          用块级 disable 而不是 `eslint-disable-next-line` —— 后者只作用于紧邻的下一行，
          一旦 prettier 把 `<p>` 拆成多行，`v-html` 就跑到第 3 行，禁用会静默失效。
        -->
        <!-- eslint-disable vue/no-v-html -->
        <p
          class="qa-sources__snippet"
          v-html="toPlainTextHtml(entry.source.snippet)"
        ></p>
        <!-- eslint-enable vue/no-v-html -->
      </li>
    </ol>
  </div>
</template>

<style scoped>
/* 与回答正文之间用一条分隔线划开，避免来源被误读成正文的一部分 */
.qa-sources {
  padding-top: 10px;
  margin-top: 12px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  border-top: 1px solid hsl(var(--border));
}

.qa-sources__toggle {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  padding: 2px 8px;
  margin-left: -8px;
  font-size: 12px;
  color: hsl(var(--primary));
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 10px;
}

.qa-sources__toggle:hover {
  background: hsl(var(--primary) / 10%);
}

.qa-sources__caret {
  font-size: 10px;
}

/* 收敛说明：比标题更轻，只作解释不抢注意力 */
.qa-sources__recalled {
  margin-left: 4px;
  color: hsl(var(--muted-foreground) / 80%);
}

.qa-sources__list {
  padding: 0;
  margin: 8px 0 0;
  list-style: none;
}

/**
 * 卡片底用 `--background` 而不是 `--accent`。
 *
 * 助手气泡本身已经是 `--muted`，而 `--accent` 与 `--muted` 取值相同，
 * 卡片会和气泡背景完全融在一起，只剩文字在浮着。
 */
.qa-sources__item {
  padding: 8px 10px;
  margin-bottom: 6px;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
}

/* 被正文角标点亮的条目 */
.qa-sources__item.is-highlight {
  background: hsl(var(--primary) / 8%);
  border-color: hsl(var(--primary));
}

.qa-sources__head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 4px;
}

/* 编号：与正文角标同款，让两处能一一对应 */
.qa-sources__index {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 10%);
  border: 1px solid hsl(var(--primary) / 30%);
  border-radius: 4px;
}

.qa-sources__doc {
  font-weight: 600;
  color: hsl(var(--foreground));
}

.qa-sources__page {
  color: hsl(var(--muted-foreground));
}

/* 分数弱化：小字、低对比度，完整维度在 title 里 */
.qa-sources__score {
  margin-left: auto;
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 75%);
}

.qa-sources__snippet {
  margin: 0;
  line-height: 1.6;
  color: hsl(var(--foreground) / 80%);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
