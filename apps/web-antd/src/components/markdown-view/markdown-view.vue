<script setup lang="ts">
import type { MarkdownViewProps } from './typing';

import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { useClipboard } from '@vueuse/core';
import { message } from 'ant-design-vue';

import { COPY_BUTTON_CLASS, renderMarkdown, SOURCE_REF_CLASS } from './render';

/**
 * Markdown 渲染视图
 *
 * **代码高亮配色由本文件的 `<style>` 提供**（`--md-code-*` 变量），
 * 不再引入 `highlight.js/styles/*.min.css`：那类静态主题把前景色写死成单一明暗，
 * 应用切到另一侧主题时就会出现「深色字配深色底」的不可读组合。
 * 这里改为「token → 变量」，明暗各给一套取值，跟随 `html.dark` 切换。
 */

// 定义组件属性
const props = defineProps<MarkdownViewProps>();

const emit = defineEmits<{
  /** 点击了正文里的引用角标；`index` 是 1 起的证据编号 */
  sourceClick: [index: number];
}>();

const { copy } = useClipboard(); // 初始化 copy 到粘贴板
const contentRef = ref<HTMLElement | null>(null);

/**
 * 渲染 markdown。
 *
 * 安全策略（禁止原始 HTML、链接协议白名单、代码块复制不落属性）全部收敛在
 * `./render` 里，组件只负责挂载与交互，避免策略散落成多处「各自记得做」。
 *
 * `sourceCount` 必须传进去：越界的 `[来源N]` 要靠它降级成纯文本。
 */
const renderedMarkdown = computed(() =>
  renderMarkdown(props.content, { sourceCount: props.sourceCount }),
);

/**
 * 复制代码块。
 *
 * 复制内容**从相邻 `code.textContent` 读取**，而不是从按钮属性读：
 * 把代码写进 `data-copy='...'` 时，代码里一个 `'` 就能闭合属性并注入事件处理器。
 * `textContent` 拿到的是高亮后节点的纯文本，与展示内容严格一致。
 */
function handleContentClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;

  // 引用角标：只把编号抛给父组件，由它去定位来源列表 ——
  // 本组件不知道 sources 长什么样，也不该知道。
  const sourceRef = target?.closest<HTMLElement>(`.${SOURCE_REF_CLASS}`);
  if (sourceRef) {
    const index = Number(sourceRef.dataset.sourceIndex);
    if (Number.isInteger(index) && index > 0) {
      emit('sourceClick', index);
    }
    return;
  }

  const button = target?.closest<HTMLElement>(`.${COPY_BUTTON_CLASS}`);
  if (!button) {
    return;
  }
  const text = button.parentElement?.querySelector('code')?.textContent ?? '';
  if (text === '') {
    return;
  }
  copy(text);
  message.success('复制成功!');
}

/** 初始化 */
onMounted(() => {
  // 事件委托挂在容器上：代码块是 v-html 动态生成的，逐个绑定会在内容更新后失效
  contentRef.value?.addEventListener('click', handleContentClick);
});

onBeforeUnmount(() => {
  // 容器节点随组件销毁，但显式解绑更稳妥（内容区被 keep-alive 复用时尤其重要）
  contentRef.value?.removeEventListener('click', handleContentClick);
});
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div ref="contentRef" class="markdown-view" v-html="renderedMarkdown"></div>
</template>

<style lang="scss">
/**
 * 这里必须是**全局样式**：`v-html` 注入的节点不会携带 scoped 属性，
 * scoped 选择器命中不了它们。
 *
 * 因此本文件的硬性约束：**颜色一律走主题变量，禁止硬编码色值**。
 * 此前 `.markdown-view` 把正文与标题写成固定的 `#3b3e55`，而助手气泡背景是
 * `hsl(var(--card))` —— 暗色主题下 `--card` 接近纯黑，深灰字压在深色底上，
 * 回答内容几乎不可读。硬编码的还有字体 `PingFang SC`（Windows 上不存在）。
 */
.markdown-view {
  /* 代码高亮 token 配色（浅色）。暗色覆盖见下方 html.dark 规则 */
  --md-code-keyword: #a626a4;
  --md-code-string: #50a14f;
  --md-code-number: #986801;
  --md-code-title: #4078f2;
  --md-code-type: #c18401;
  --md-code-attr: #e45649;
  --md-code-comment: #9ca3af;

  max-width: 100%;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.75;
  color: hsl(var(--foreground));
  text-align: left;
  overflow-wrap: anywhere;

  /* 气泡内首尾元素不保留外边距，否则气泡会多出一圈空白 */
  > :first-child {
    margin-top: 0;
  }

  > :last-child {
    margin-bottom: 0;
  }

  p {
    margin: 0 0 10px;
  }

  a {
    color: hsl(var(--primary));
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  strong {
    font-weight: 600;
    color: hsl(var(--foreground));
  }

  /**
   * 引用角标 `[来源N]`（由 render.ts 注入）。
   *
   * 做成小号方块而不是单纯的上标数字：回答里常连续出现多个角标，
   * 方块更容易看清边界，也更明确地表达「这是一个可以点的东西」。
   * 配色走主题变量，明暗主题下都保持可读。
   */
  .md-source-ref {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
    margin: 0 2px;
    font-family: inherit;
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    vertical-align: text-top;
    color: hsl(var(--primary));
    cursor: pointer;
    background: hsl(var(--primary) / 10%);
    border: 1px solid hsl(var(--primary) / 30%);
    border-radius: 4px;
    transition:
      background-color 0.15s ease,
      border-color 0.15s ease;
  }

  .md-source-ref:hover {
    background: hsl(var(--primary) / 22%);
    border-color: hsl(var(--primary));
  }

  .md-source-ref:focus-visible {
    outline: 2px solid hsl(var(--primary));
    outline-offset: 1px;
  }

  /* 标题 */
  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    margin: 20px 0 8px;
    font-weight: 600;
    line-height: 1.4;
    color: hsl(var(--foreground));
  }

  h1 {
    font-size: 20px;
  }

  h2 {
    font-size: 18px;
  }

  h3 {
    font-size: 16px;
  }

  h4,
  h5,
  h6 {
    font-size: 14px;
  }

  /* 列表 */
  ul,
  ol {
    padding-left: 22px;
    margin: 0 0 10px;
  }

  li {
    margin-bottom: 4px;
  }

  li::marker {
    color: hsl(var(--muted-foreground));
  }

  li > ul,
  li > ol {
    margin: 4px 0 0;
  }

  /* 引用块 */
  blockquote {
    padding: 2px 0 2px 12px;
    margin: 0 0 10px;
    color: hsl(var(--muted-foreground));
    border-left: 3px solid hsl(var(--border));
  }

  /* 行内代码 */
  :not(pre) > code {
    padding: 2px 5px;
    font-family: ui-monospace, sfmono-regular, menlo, consolas, monospace;
    font-size: 0.9em;
    color: hsl(var(--foreground));
    background: hsl(var(--muted));
    border: 1px solid hsl(var(--border));
    border-radius: 4px;
  }

  /* 代码块。position: relative 供复制按钮绝对定位（按钮由 render.ts 注入） */
  pre {
    position: relative;
    margin: 0 0 12px;
    overflow: hidden;
    background: hsl(var(--muted));
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
  }

  pre code.hljs {
    display: block;
    max-width: 100%;
    padding: 12px 14px;
    overflow-x: auto;
    font-family: ui-monospace, sfmono-regular, menlo, consolas, monospace;
    font-size: 12.5px;
    line-height: 1.7;
    color: hsl(var(--foreground));
    background: transparent;
  }

  /* 表格：宽度受限时横向滚动，不撑破气泡 */
  table {
    display: block;
    max-width: 100%;
    margin: 0 0 12px;
    overflow-x: auto;
    font-size: 13px;
    border-collapse: collapse;
  }

  th,
  td {
    padding: 6px 10px;
    color: hsl(var(--foreground));
    border: 1px solid hsl(var(--border));
  }

  th {
    font-weight: 600;
    background: hsl(var(--muted));
  }

  hr {
    margin: 16px 0;
    border: none;
    border-top: 1px solid hsl(var(--border));
  }

  /**
   * 复制按钮。
   *
   * 默认透明、悬停代码块才浮现（与 GitHub 一致）：常驻会在长代码行上压住内容。
   * 键盘用户通过 `:focus-visible` 同样能看到它。
   */
  .md-copy-btn {
    position: absolute;
    top: 6px;
    right: 8px;
    padding: 2px 8px;
    font-size: 11px;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border));
    border-radius: 4px;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .md-copy-btn:hover {
    color: hsl(var(--primary));
    border-color: hsl(var(--primary));
  }

  pre:hover .md-copy-btn,
  .md-copy-btn:focus-visible {
    opacity: 1;
  }
}

/* 暗色主题下的代码高亮 token 配色 */
html.dark .markdown-view {
  --md-code-keyword: #c678dd;
  --md-code-string: #98c379;
  --md-code-number: #d19a66;
  --md-code-title: #61afef;
  --md-code-type: #e5c07b;
  --md-code-attr: #e06c75;
  --md-code-comment: #7f848e;
}

/* hljs token → 上方的主题变量。只映射实际会出现的 token 类别 */
.markdown-view .hljs-keyword,
.markdown-view .hljs-selector-tag,
.markdown-view .hljs-literal,
.markdown-view .hljs-section,
.markdown-view .hljs-doctag,
.markdown-view .hljs-name,
.markdown-view .hljs-strong {
  color: var(--md-code-keyword);
}

.markdown-view .hljs-string,
.markdown-view .hljs-regexp,
.markdown-view .hljs-addition,
.markdown-view .hljs-symbol,
.markdown-view .hljs-bullet,
.markdown-view .hljs-template-variable {
  color: var(--md-code-string);
}

.markdown-view .hljs-number {
  color: var(--md-code-number);
}

/* hljs 生成的类名含下划线（.hljs-built_in），无法改名，放行该规则 */
/* stylelint-disable selector-class-pattern */
.markdown-view .hljs-title,
.markdown-view .hljs-built_in {
  color: var(--md-code-title);
}
/* stylelint-enable selector-class-pattern */

.markdown-view .hljs-type,
.markdown-view .hljs-variable,
.markdown-view .hljs-params {
  color: var(--md-code-type);
}

.markdown-view .hljs-attr,
.markdown-view .hljs-attribute,
.markdown-view .hljs-property,
.markdown-view .hljs-meta,
.markdown-view .hljs-selector-attr,
.markdown-view .hljs-selector-class,
.markdown-view .hljs-selector-id {
  color: var(--md-code-attr);
}

.markdown-view .hljs-comment,
.markdown-view .hljs-quote,
.markdown-view .hljs-deletion {
  color: var(--md-code-comment);
}

.markdown-view .hljs-emphasis {
  font-style: italic;
}
</style>
