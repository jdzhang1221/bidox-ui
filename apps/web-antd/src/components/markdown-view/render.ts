import { MarkdownIt } from '@vben/plugins/markmap';

import hljs from 'highlight.js';

/**
 * Markdown 渲染与安全策略（企业知识问答，批次 A §4.5）
 *
 * 背景：问答答案与引用片段都来自「模型输出 + 上游文档」，属于不可信内容。
 * 这些内容会被 `v-html` 注入到页面，所以渲染器必须自己承担安全责任：
 *
 * - **禁止原始 HTML**：`<img onerror>`、`<script>` 一律转义成文本，不参与解析；
 * - **校验链接协议**：只放行 http / https / mailto / tel，`javascript:`、`data:`、`vbscript:` 直接不生成 `<a>`；
 * - **代码块复制不落属性**：复制按钮只带 class，复制内容在点击时从相邻 `code.textContent` 读取，
 *   绝不把代码拼进 HTML 属性 —— 代码里一个 `'` 就能闭合属性并注入事件处理器；
 * - **引用片段纯文本**：见 {@link toPlainTextHtml}。
 */

/** 允许出现在链接上的协议，其余一律拒绝。 */
export const SAFE_LINK_PROTOCOLS: ReadonlySet<string> = new Set([
  'http:',
  'https:',
  'mailto:',
  'tel:',
]);

/**
 * 复制按钮的 class。
 *
 * 刻意**不用 `id`**：一页会有多个代码块，重复 `id` 既非法又会让 `getElementById` 取错节点。
 */
export const COPY_BUTTON_CLASS = 'md-copy-btn';

/** 形如 `scheme:` 的协议前缀（`javascript:` / `data:` / `http:` 都会命中）。 */
const SCHEME_RE = /^[a-z][\d+.a-z-]*:/i;

/**
 * 引用角标的 class。
 *
 * 与复制按钮同理导出常量：组件侧靠 class 做事件委托，手写字符串迟早会写错一处。
 */
export const SOURCE_REF_CLASS = 'md-source-ref';

/**
 * 引用角标 `[来源N]` 的**模式源码**（不含锚定）。
 *
 * N 是**证据编号**（从 1 起），由 Python 侧 `enumerate(results, 1)` 生成，与最终回传的
 * `sources` 数组严格同序同长，因此 `[来源N]` 对应 `sources[N - 1]`。
 * 限定 1~3 位数字：编号不可能是四位数，放宽只会让正则多匹配到无关文本。
 *
 * 导出成**字符串**而不是 `RegExp` 实例，是因为两处用法对标志位的要求相反：
 *
 * - 这里的 inline rule 需要带 `^` 的锚定版本（从 `state.pos` 处匹配）；
 * - `views/bid/knowledge-qa/citation.ts` 需要在整段正文里**全局**扫描，用来判断
 *   「哪些来源真的被答案引用了」。
 *
 * 共享同一份源码字符串，两边就不可能漂移。一旦漂移，症状是「角标点得开、但来源列表里
 * 找不到那一条」或反过来，且只在某些答案上复现，非常难查。
 */
export const SOURCE_REF_PATTERN = String.raw`\[来源(\d{1,3})\]`;

const SOURCE_REF_RE = new RegExp(`^${SOURCE_REF_PATTERN}`, 'u');

/**
 * 渲染期的外部数据。
 *
 * 走 `env` 而不是闭包：`renderMarkdown` 用的是一个进程内共享实例，
 * 把每条消息的上下文塞进闭包会让共享实例无法复用。
 */
export interface MarkdownRenderEnv {
  /**
   * 本轮回答可用的来源条数。
   *
   * 模型可能把**上一轮**的角标抄进本轮回答（历史消息也在 prompt 里），
   * 于是 N 会超出本轮 sources 长度。越界时必须退化成纯文本 ——
   * 宁可点不动，也不能让用户点开一条**错误的**来源。
   */
  sourceCount?: number;
}

/**
 * 复制按钮的 HTML。
 *
 * 用原生 `<button type="button">` 而不是 `<div role="button">`：
 * 原生按钮自带键盘可达性（Tab 聚焦、Enter/Space 触发），不必再补 `tabindex` 与
 * `keydown` 处理；`type="button"` 是必需的 —— 缺省类型是 `submit`，
 * 一旦这段 HTML 落在某个 `<form>` 内就会误触发表单提交。
 *
 * **不带任何内联样式**：按钮的定位与配色全部由 `markdown-view.vue` 的 CSS 负责，
 * 那里才能拿到主题变量。此前内联的 `color: #fff` 在浅色代码主题下会让按钮文字消失。
 */
const COPY_BUTTON_HTML = `<button class="${COPY_BUTTON_CLASS}" type="button" aria-label="复制代码">复制</button>`;

/**
 * 判断链接地址是否安全。
 *
 * 规则：
 * 1. 空串 / 纯空白 → 拒绝；
 * 2. 不含协议前缀（锚点 `#x`、查询串 `?x`、相对路径 `a/b`、站内绝对路径 `/admin/x`）→ 放行；
 * 3. 含协议前缀 → 只放行 {@link SAFE_LINK_PROTOCOLS}；协议存在但无法解析成 URL 时**保守拒绝**。
 */
export function isSafeLink(url: null | string | undefined): boolean {
  const raw = (url ?? '').trim();
  if (raw === '') {
    return false;
  }
  if (!SCHEME_RE.test(raw)) {
    return true;
  }
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(raw).protocol.toLowerCase());
  } catch {
    // 例如 `javascript:alert(1)` 这类非层级 URL 在某些实现下会抛错，一律当作不安全
    return false;
  }
}

/**
 * HTML 文本转义。
 *
 * 转义 `&` 必须放在最前面，否则会把后面刚生成的实体再转义一遍（`&lt;` → `&amp;lt;`）。
 */
export function escapeHtml(text: null | string | undefined): string {
  return (text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * 把纯文本（引用片段 snippet、命中关键词等）渲染成**只能当文本看**的 HTML。
 *
 * 优先在模板里写 `{{ snippet }}`（Vue 自动转义）；只有在必须 `v-html` 时才用本函数。
 * 两者都保证片段里的 `<script>`、`onerror=` 只是可见字符，不会变成可执行节点。
 */
export function toPlainTextHtml(text: null | string | undefined): string {
  return escapeHtml(text);
}

/** 从代码块 token 中取出语言（```js title=xxx → `js`）。 */
function resolveLanguage(info: null | string | undefined): string {
  const normalized = (info ?? '').trim();
  if (normalized === '') {
    return '';
  }
  return normalized.split(/\s+/)[0] ?? '';
}

/**
 * 创建一个配置好安全策略的 MarkdownIt 实例。
 *
 * 导出为工厂（而不是只给单例）是为了让测试能拿到互不影响的实例。
 */
export function createMarkdownRenderer(): MarkdownIt {
  const md = new MarkdownIt({
    // 显式关闭原始 HTML。这是 markdown-it 的默认值，但必须写出来：
    // 它承担的是「不可信内容不能变成节点」这条安全约束，不能被后续配置顺手改掉。
    html: false,
  });

  // 链接协议白名单：不安全的链接不会生成 <a>，只会退化成纯文本
  md.validateLink = (url: string) => isSafeLink(url);

  // 引用角标 `[来源N]` → 可点击按钮。
  //
  // 注册在 `link` **之后**：`[来源1](http://…)` 这种真链接要先被 link 规则消费掉，
  // 裸 `[来源1]` 才会落到这里。link 匹配失败时不推进 pos，所以这个顺序是安全的。
  //
  // 代码块与行内代码不会走到本规则：fence / code_block 是 block 级 token，
  // 行内代码在更早的 backticks 规则里已被整体消费。
  md.inline.ruler.after('link', 'source_ref', (state, silent) => {
    const start = state.pos;
    if (state.src.codePointAt(start) !== 0x5b /* [ */) {
      return false;
    }
    // 只截取够长的窗口做匹配，避免对整个剩余串跑正则
    const match = SOURCE_REF_RE.exec(state.src.slice(start, start + 12));
    if (!match) {
      return false;
    }
    if (!silent) {
      const token = state.push('source_ref', '', 0);
      token.meta = { index: Number(match[1]) };
      state.pos = start + match[0].length;
    }
    return true;
  });

  md.renderer.rules.source_ref = (tokens, idx, _options, env) => {
    const index = (tokens[idx]!.meta as { index: number }).index;
    const count = (env as MarkdownRenderEnv).sourceCount;
    if (count !== undefined && count !== null && index > count) {
      // 越界：退化成纯文本，不给用户一个会跳到错误来源的按钮
      return escapeHtml(`[来源${index}]`);
    }
    // index 已由 Number() 收敛为纯数字，拼进属性不存在注入面
    return (
      `<button class="${SOURCE_REF_CLASS}" type="button" ` +
      `data-source-index="${index}" title="查看引用来源 ${index}">${index}</button>`
    );
  };

  // 代码块：自己接管 fence 渲染，才能挂上复制按钮。
  // 注意按钮**不携带任何代码内容**，复制时从相邻 code.textContent 读取。
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx]!;
    const lang = resolveLanguage(token.info);
    const code = token.content;
    const highlighted =
      lang !== '' && hljs.getLanguage(lang)
        ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
        : escapeHtml(code);
    // 不带内联样式：`position: relative` 由样式表提供，才能与按钮的绝对定位
    // 放在同一处维护。按钮必须留在 `<pre>` 内部 —— 复制逻辑靠
    // `button.parentElement.querySelector('code')` 取内容。
    return `<pre>${COPY_BUTTON_HTML}<code class="hljs">${highlighted}</code></pre>\n`;
  };

  // 外链强制新窗口打开，并断开 opener 引用（避免 reverse tabnabbing）
  const defaultLinkOpen =
    md.renderer.rules.link_open ??
    ((tokens, idx, options, _env, self) =>
      self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx]!.attrSet('target', '_blank');
    tokens[idx]!.attrSet('rel', 'noopener noreferrer');
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  return md;
}

let sharedRenderer: MarkdownIt | null = null;

/** 渲染 Markdown 为 HTML（使用进程内共享实例）。 */
export function renderMarkdown(
  content: null | string | undefined,
  env?: MarkdownRenderEnv,
): string {
  sharedRenderer ??= createMarkdownRenderer();
  // env 每次调用单独传入，所以共享实例不会串味
  return sharedRenderer.render(content ?? '', env ?? {});
}
