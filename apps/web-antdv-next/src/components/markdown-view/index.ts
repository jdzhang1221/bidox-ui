export { default as MarkdownView } from './markdown-view.vue';

// 渲染与安全策略：引用片段（snippet）等纯文本场景直接用 `toPlainTextHtml`，
// 不要在业务组件里各写一遍转义
export * from './render';
export * from './typing';
