<script lang="ts" setup>
import type { CitedSourceEntry } from '../citation';

import type { BidKnowledgeQaApi } from '#/api/bid/knowledge-qa';

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

import { getSourceChunks } from '#/api/bid/knowledge-qa';
import { toPlainTextHtml } from '#/components/markdown-view';

/**
 * 引用来源列表
 *
 * 四个不能含糊的点：
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
 * 4. **正文按需拉取**（2026-09-19）。`sources` 事件里**没有 snippet**：正文会让
 *    SSE 帧随「条数 × 摘要长度」双向膨胀，服务端只能把它压到 20 字
 *    （实测用户看到「随着明珠集团信息化建设的不断深入，因传统」这种残句）。
 *    现在改为按 `chunkId` 调 `getSourceChunks()` 取完整原文。
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
    /**
     * 是否**真的**按引用收敛过，来自 `resolveCitedSources().filtered`。
     *
     * `false` 表示答案正文里没有任何可识别的 `[来源N]`（模型整段没标注），
     * 此时 `entries` 是**全量兜底**而不是「被引用的来源」。
     * 实测过一轮：「未找到相关依据」的回答召回 6 条、正文零标注，
     * 而标题仍写「引用来源 6 条」——等于告诉用户这 6 条就是答案的依据。
     * 必须换文案，见 `citation.ts` 的规则 2。
     */
    filtered?: boolean;
    /** 本轮检索召回的条数，用于说明「为什么不是全部」 */
    recalledCount?: number;
  }>(),
  {
    activeIndex: undefined,
    defaultExpanded: false,
    entries: () => [],
    filtered: true,
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

/**
 * 标题文案。
 *
 * 未收敛时（答案没标注引用）不能说「引用来源」—— 那 6 条只是检索召回，
 * 正文一条都没引。改成「检索到的来源」并补一句说明，避免误导。
 */
const toggleLabel = computed(() =>
  props.filtered
    ? `引用来源 ${items.value.length} 条`
    : `检索到的来源 ${items.value.length} 条`,
);

/**
 * 页码标签。
 *
 * ⚠️ 必须把 `<= 0` 当成「未知」而不是页码 0。
 * Python 侧 `DocumentBuilder._page` 的初始值就是 **0**（`app/document/ast/builder.py:21`），
 * 只有 PDF 解析器才会 `set_page(page_no)`（从 1 开始）；而上传入口只收 `.docx`，
 * 于是 docx 文档的 `pageStart/pageEnd` 恒为 0 —— 界面上会一直显示无意义的「P0」。
 */
function pageLabel(source: BidKnowledgeQaApi.Source): string {
  const start = toPageNumber(source.pageStart);
  const end = toPageNumber(source.pageEnd);
  if (start === null && end === null) {
    return '';
  }
  if (start !== null && end !== null && start !== end) {
    return `P${start}–P${end}`;
  }
  return `P${start ?? end}`;
}

/** 页码归一化：非正数（0 / 负数）视为「未知」，返回 null */
function toPageNumber(value: null | number | undefined): null | number {
  return typeof value === 'number' && value > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// 正文按需拉取
//
// 三个必须处理好的点：
//
// 1. **按 chunkId 回填，不能按数组下标**。接口不保证顺序、也不保证每个编号都命中
//    （文档可能在问答之后被删除），靠下标会把正文贴到别的引用上。
// 2. **整列表批量拉一次，不是每条一个请求**。一次展开通常十几条，逐条请求会产生
//    十几个往返；接口本身也设计成批量的（上限 200 条）。
// 3. **失败要能被看见**。静默留白会让用户以为「这条本来就没内容」，
//    而真相是请求挂了 —— 必须区分出「加载中 / 加载失败 / 确实取不到」三种状态。
// ---------------------------------------------------------------------------

/** chunkId -> 正文内容。取不到（文档已删）的不进 map */
const contentMap = ref<Map<number, string>>(new Map());
/** chunkId -> 加载失败标记 */
const failedIds = ref<Set<number>>(new Set());
/** 是否正在拉取（整列表共用一个状态，因为是一次批量请求） */
const loading = ref(false);

/**
 * 收集本次需要拉取的 chunkId。
 *
 * 只取「当前条目里、还没拉过的」—— 列表收敛后条目会变（答案标注不同），
 * 每次变化都重新拉没拉过的部分，已有内容不重复请求。
 */
function pendingChunkIds(): number[] {
  const result: number[] = [];
  for (const entry of items.value) {
    const id = entry.source.chunkId;
    if (typeof id !== 'number') continue;
    if (contentMap.value.has(id) || failedIds.value.has(id)) continue;
    if (result.includes(id)) continue;
    result.push(id);
  }
  return result;
}

async function loadContents(): Promise<void> {
  const ids = pendingChunkIds();
  if (ids.length === 0) {
    return;
  }
  loading.value = true;
  try {
    const chunks = await getSourceChunks(ids);
    // 先落成功项：局部更新而非整体替换，避免把并发请求的结果覆盖掉
    const next = new Map(contentMap.value);
    for (const chunk of chunks) {
      if (typeof chunk.chunkId === 'number') {
        next.set(chunk.chunkId, chunk.content ?? '');
      }
    }
    contentMap.value = next;
    // 请求成功但某些 id 没回来 = 文档已删，标记为「取不到」而不是永远重试
    const missing = ids.filter((id) => !next.has(id));
    if (missing.length > 0) {
      const nextFailed = new Set(failedIds.value);
      for (const id of missing) nextFailed.add(id);
      failedIds.value = nextFailed;
    }
  } catch {
    // 整批请求失败（网络抖动 / 服务短暂不可用）：整批标记为「取不到」。
    //
    // 刻意**不**留一个「稍后自动重试」的口子：`pendingChunkIds()` 会跳过
    // `failedIds` 里的编号，如果网络一直不通、这里又不写 failedIds，
    // watch 每次触发都会重新发一轮注定失败的请求 —— 变成重试风暴。
    // 用户想重试时刷新页面 / 重新提问即可（那会重建组件）。
    const nextFailed = new Set(failedIds.value);
    for (const id of ids) nextFailed.add(id);
    failedIds.value = nextFailed;
  } finally {
    loading.value = false;
  }
}

/** 某条来源的展示状态 */
function snippetState(chunkId: null | number | undefined): {
  failed: boolean;
  loading: boolean;
  text: null | string;
} {
  if (typeof chunkId !== 'number') {
    return { failed: true, loading: false, text: null };
  }
  if (contentMap.value.has(chunkId)) {
    return {
      failed: false,
      loading: false,
      text: contentMap.value.get(chunkId) ?? '',
    };
  }
  return {
    failed: failedIds.value.has(chunkId),
    loading: loading.value,
    text: null,
  };
}

/**
 * 正文折叠阈值（字符数）。
 *
 * 现在是**完整 chunk 原文**（实测最长 1346 字），且常含 Markdown 表格；
 * 用 `white-space: pre-wrap` 渲染后单个片段能撑到 693px 高，6 条来源就是两千多像素的滚动墙。
 * 超过阈值时默认折叠为 3 行 + 「展开全文」。
 */
const SNIPPET_CLAMP_CHARS = 160;

/** 已展开全文的片段（按原始证据编号记录） */
const expandedSnippets = ref<Set<number>>(new Set());

function isSnippetExpanded(index: number): boolean {
  return expandedSnippets.value.has(index);
}

function toggleSnippet(index: number): void {
  // 换新 Set 而不是原地 mutate：`ref` 的 Set 原地改不会触发更新
  const next = new Set(expandedSnippets.value);
  if (next.has(index)) {
    next.delete(index);
  } else {
    next.add(index);
  }
  expandedSnippets.value = next;
}

/** 是否需要折叠开关：只对「已加载且够长」的正文显示 */
function needsSnippetToggle(entry: CitedSourceEntry): boolean {
  const state = snippetState(entry.source.chunkId);
  return (
    !state.failed &&
    state.text !== null &&
    state.text.length > SNIPPET_CLAMP_CHARS
  );
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

// 列表一展开就拉正文。不挂在条目自身上：批量请求需要「一次性知道要拉哪些」，
// 逐条触发会退化成 N 个请求。
//
// `immediate: true` 是必要的：正文拉取与「用户是否展开列表」无关 ——
// 折叠状态下 `ol` 也渲染（`v-show`），正文早一点到位，展开时就不用等。
watch(
  [() => expanded.value, items, () => props.defaultExpanded],
  () => {
    void loadContents();
  },
  { immediate: true },
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
      {{ toggleLabel }}
    </button>
    <!-- 说明「为什么不是全部」，避免用户以为来源丢了 -->
    <span v-if="hasHidden" class="qa-sources__recalled">
      （检索召回 {{ recalledCount }} 条，仅显示被答案引用的）
    </span>
    <!-- 未收敛：答案正文没标注引用，这里是全量兜底，必须说清楚 -->
    <span v-else-if="!filtered" class="qa-sources__recalled">
      （答案未标注引用，此处为全部召回结果）
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
          正文是**按需拉取**的（`sources` 事件里没有 snippet，见 script 顶部说明），
          因此这里要区分三种状态：加载中 / 取不到 / 有内容。
          静默留白会让用户以为「这条本来就没内容」，而真相可能是请求挂了。
        -->
        <p
          v-if="snippetState(entry.source.chunkId).loading"
          class="qa-sources__snippet is-muted"
        >
          正在加载原文…
        </p>
        <p
          v-else-if="snippetState(entry.source.chunkId).failed"
          class="qa-sources__snippet is-muted"
        >
          原文暂不可用（文档可能已被删除）
        </p>
        <!--
          snippet 走 `toPlainTextHtml` 转义后再 v-html：它是上游文档原文，属不可信内容。
          用块级 disable 而不是 `eslint-disable-next-line` —— 后者只作用于紧邻的下一行，
          一旦 prettier 把 `<p>` 拆成多行，`v-html` 就跑到第 3 行，禁用会静默失效。
        -->
        <!-- eslint-disable vue/no-v-html -->
        <p
          v-else
          class="qa-sources__snippet"
          :class="{ 'is-clamped': !isSnippetExpanded(entry.index) }"
          v-html="toPlainTextHtml(snippetState(entry.source.chunkId).text)"
        ></p>
        <!-- eslint-enable vue/no-v-html -->
        <button
          v-if="needsSnippetToggle(entry)"
          class="qa-sources__snippet-toggle"
          type="button"
          @click="toggleSnippet(entry.index)"
        >
          {{ isSnippetExpanded(entry.index) ? '收起' : '展开全文' }}
        </button>
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

/**
 * 加载中 / 取不到：比正文更弱。
 *
 * 这两句文案不是「内容」，是「状态」。若沿用正文的 80% 前景色，
 * 用户会把它当成真实原文来读 —— 尤其「原文暂不可用」很容易被误读成
 * 「这条来源的正文就这么一句话」。
 */
.qa-sources__snippet.is-muted {
  font-style: normal;
  color: hsl(var(--muted-foreground) / 85%);
}

/**
 * 折叠态：只留 3 行（3 × 1.6em）。
 *
 * 用 `max-height` 而不是 `-webkit-line-clamp`：片段带 `white-space: pre-wrap`，
 * line-clamp 需要 `display: -webkit-box`，两者叠加在部分内核上会把换行压成一行。
 * `em` 相对自身 font-size（12px），3 行 = 4.8em = 57.6px。
 */
.qa-sources__snippet.is-clamped {
  max-height: 4.8em;
  overflow: hidden;
}

/* 折叠提示：小号主色链接，跟在片段末尾 */
.qa-sources__snippet-toggle {
  padding: 0;
  margin-top: 2px;
  font-size: 11px;
  color: hsl(var(--primary));
  cursor: pointer;
  background: transparent;
  border: none;
}

.qa-sources__snippet-toggle:hover {
  text-decoration: underline;
}
</style>
