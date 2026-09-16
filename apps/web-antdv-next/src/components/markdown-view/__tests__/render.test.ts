import { describe, expect, it } from 'vitest';

import {
  COPY_BUTTON_CLASS,
  escapeHtml,
  isSafeLink,
  renderMarkdown,
  SOURCE_REF_CLASS,
  toPlainTextHtml,
} from '../render';

/**
 * Markdown 安全回归（批次 A §4.5）
 *
 * 验收原文：Markdown XSS 用例通过。
 *
 * 覆盖四类攻击面：
 * 1. **引号闭合**：代码里一个 `'` 就能闭合 `data-copy='...'` 并注入事件属性；
 * 2. **事件属性 / 原始 HTML**：`<img onerror>`、`<script>`、`onclick=` 不得变成节点；
 * 3. **恶意 URL**：`javascript:` / `vbscript:` / `data:` / `file:` 不得生成 `<a>`；
 * 4. **引用片段**：snippet 必须始终当纯文本渲染。
 *
 * 每个「禁止」类断言都配一条「正常内容仍然渲染」的反证，避免把渲染器整个关掉也算通过。
 */

/**
 * 把渲染结果挂到 DOM 上再做结构断言 —— 只做字符串匹配会把「被转义成文本」误判成「注入成功」。
 *
 * `env` 用于传 `sourceCount`（引用角标的越界判断）。
 */
function renderToDom(
  content: string,
  env?: { sourceCount?: number },
): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = renderMarkdown(content, env);
  return container;
}

/** 构造一个带语言标记的围栏代码块。 */
function fencedCode(code: string, lang = ''): string {
  return `\`\`\`${lang}\n${code}\n\`\`\``;
}

describe('原始 HTML 与事件属性', () => {
  it('script 标签被转义成文本，不生成 script 节点', () => {
    const container = renderToDom('<script>alert(1)</script>');

    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>');
  });

  it('img onerror 不生成 img 节点，也不残留 onerror 属性', () => {
    const container = renderToDom('<img src=x onerror="alert(1)">');

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelectorAll('[onerror]')).toHaveLength(0);
    expect(container.textContent).toContain('onerror');
  });

  it('内联 HTML 的 onclick 不生成可点击节点', () => {
    const container = renderToDom('<div onclick="alert(1)">点我</div>');

    expect(container.querySelectorAll('[onclick]')).toHaveLength(0);
  });
});

describe('代码块的引号闭合注入', () => {
  const quoteBreakout = `const s = 'a' + "b"; // x' onmouseover='alert(1)`;

  it('复制按钮不携带代码内容，代码里的引号无法闭合属性', () => {
    const container = renderToDom(fencedCode(quoteBreakout, 'js'));

    const button = container.querySelector<HTMLElement>(
      `.${COPY_BUTTON_CLASS}`,
    );
    expect(button).not.toBeNull();
    // 老实现是 data-copy='...'：代码里的单引号会闭合属性并凭空造出 onmouseover
    expect(button?.dataset.copy).toBeUndefined();
    expect(container.querySelectorAll('[onmouseover]')).toHaveLength(0);
  });

  it('代码块结构不被闭合标签破坏', () => {
    const container = renderToDom(
      fencedCode(`</code></pre><img src=x onerror=alert(1)>`, 'js'),
    );

    expect(container.querySelectorAll('pre')).toHaveLength(1);
    expect(container.querySelectorAll('code')).toHaveLength(1);
    expect(container.querySelectorAll(`.${COPY_BUTTON_CLASS}`)).toHaveLength(1);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelectorAll('[onerror]')).toHaveLength(0);
  });

  it('复制按钮是 code 的前一个兄弟节点（复制逻辑据此取 textContent）', () => {
    const container = renderToDom(fencedCode(quoteBreakout, 'js'));

    const button = container.querySelector(`.${COPY_BUTTON_CLASS}`)!;
    const code = button.parentElement?.querySelector('code');
    expect(code).not.toBeNull();
    // 高亮只加 span、不改文本：textContent 必须与原始代码逐字一致
    expect(code?.textContent).toBe(`${quoteBreakout}\n`);
  });

  it('未标注语言的代码块同样有复制按钮，且内容被转义', () => {
    const container = renderToDom(fencedCode('<x> & </x>'));

    expect(container.querySelectorAll(`.${COPY_BUTTON_CLASS}`)).toHaveLength(1);
    expect(container.querySelector('x')).toBeNull();
    expect(container.querySelector('code')?.textContent).toBe('<x> & </x>\n');
  });

  it('未知语言回退为转义纯文本，不抛异常', () => {
    const container = renderToDom(fencedCode('<y>', 'no-such-language'));

    expect(container.querySelector('y')).toBeNull();
    expect(container.querySelector('code')?.textContent).toBe('<y>\n');
  });
});

describe('链接协议白名单', () => {
  it.each([
    ['javascript:alert(1)', 'javascript'],
    ['vbscript:msgbox(1)', 'vbscript'],
    ['data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', 'data'],
    ['file:///etc/passwd', 'file'],
    ['  JavaScript:alert(1)  ', '带空格与大写的 javascript'],
  ])('拒绝危险协议 %s（%s）', (url) => {
    const container = renderToDom(`[点我](${url})`);

    expect(container.querySelector('a')).toBeNull();
    // 链接退化成了纯文本，而不是被悄悄删掉
    expect(container.textContent).toContain('点我');
  });

  it('危险协议的图片不生成 img 节点', () => {
    const container = renderToDom('![x](javascript:alert(1))');

    expect(container.querySelector('img')).toBeNull();
  });

  it('https 链接生成 <a>，并强制新窗口 + 断开 opener', () => {
    const container = renderToDom('[点我](https://example.com/a?b=1)');

    const anchor = container.querySelector('a')!;
    expect(anchor).not.toBeNull();
    expect(anchor.getAttribute('href')).toBe('https://example.com/a?b=1');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it.each([
    ['/admin/bid/document', '站内绝对路径'],
    ['#section', '锚点'],
    ['mailto:someone@example.com', '邮件'],
    ['docs/a.md', '相对路径'],
  ])('放行 %s（%s）', (url) => {
    const container = renderToDom(`[点我](${url})`);

    expect(container.querySelector('a')).not.toBeNull();
  });

  it('isSafeLink 对空值一律拒绝', () => {
    for (const value of ['', '   ', null, undefined]) {
      expect(isSafeLink(value)).toBe(false);
    }
  });
});

describe('引用片段纯文本渲染', () => {
  it('片段里的标签与事件属性都只是可见字符', () => {
    const container = document.createElement('div');
    container.innerHTML = toPlainTextHtml(
      '<img src=x onerror=alert(1)><script>alert(2)</script>',
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<img');
  });

  it('引号被转义，可用于属性上下文', () => {
    const escaped = toPlainTextHtml(`it's "quoted"`);

    expect(escaped).toContain('&#39;');
    expect(escaped).toContain('&quot;');
    expect(escaped).not.toContain(`'`);
    expect(escaped).not.toContain(`"`);
  });

  it('escapeHtml 先转义 & 避免二次转义', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
    expect(escapeHtml('&')).toBe('&amp;');
  });

  it('toPlainTextHtml 对空值返回空串', () => {
    expect(toPlainTextHtml(null)).toBe('');
    expect(toPlainTextHtml(undefined)).toBe('');
  });
});

describe('正常内容渲染不回归', () => {
  it('标题、列表、加粗仍然渲染', () => {
    const container = renderToDom('# 标题\n\n- a\n- b\n\n**加粗**');

    expect(container.querySelector('h1')?.textContent).toBe('标题');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('strong')?.textContent).toBe('加粗');
  });

  it('已知语言的代码块仍然高亮', () => {
    const container = renderToDom(fencedCode('const a = 1;', 'js'));

    const code = container.querySelector('code')!;
    expect(code.classList.contains('hljs')).toBe(true);
    expect(code.innerHTML).toContain('hljs-keyword');
    expect(code.textContent).toBe('const a = 1;\n');
  });

  it('空内容渲染为空串', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(null)).toBe('');
  });
});

describe('引用角标 [来源N]', () => {
  it('裸 [来源1] 渲染成按钮，并带上编号', () => {
    const container = renderToDom('[来源1]');

    const ref = container.querySelector<HTMLElement>(`.${SOURCE_REF_CLASS}`);
    expect(ref).not.toBeNull();
    expect(ref?.tagName).toBe('BUTTON');
    expect(ref?.dataset.sourceIndex).toBe('1');
  });

  it('多位编号同样识别', () => {
    const container = renderToDom('[来源12]');

    expect(
      container.querySelector<HTMLElement>(`.${SOURCE_REF_CLASS}`)?.dataset
        .sourceIndex,
    ).toBe('12');
  });

  it('与相邻正文混排时不吞掉文字', () => {
    const container = renderToDom('保证金上限为 2%[来源1]，依据见[来源2]。');

    expect(container.querySelectorAll(`.${SOURCE_REF_CLASS}`)).toHaveLength(2);
    expect(container.textContent).toContain('保证金上限为 2%');
    expect(container.textContent).toContain('，依据见');
  });

  it('代码块内的 [来源1] 不被替换', () => {
    const container = renderToDom(fencedCode('[来源1]'));

    expect(container.querySelector(`.${SOURCE_REF_CLASS}`)).toBeNull();
    expect(container.querySelector('code')?.textContent).toContain('[来源1]');
  });

  it('行内代码内的 [来源1] 不被替换', () => {
    const container = renderToDom('`[来源1]`');

    expect(container.querySelector(`.${SOURCE_REF_CLASS}`)).toBeNull();
    expect(container.querySelector('code')?.textContent).toBe('[来源1]');
  });

  it('真链接语法优先于角标规则', () => {
    const container = renderToDom('[来源1](https://example.com/a)');

    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.com/a',
    );
    expect(container.querySelector(`.${SOURCE_REF_CLASS}`)).toBeNull();
  });

  it('非数字编号不识别成角标', () => {
    const container = renderToDom('[来源甲]');

    expect(container.querySelector(`.${SOURCE_REF_CLASS}`)).toBeNull();
    expect(container.textContent).toContain('[来源甲]');
  });

  it('编号超出 sourceCount 时退化为纯文本，不生成按钮', () => {
    const container = renderToDom('[来源5]', { sourceCount: 2 });

    expect(container.querySelector(`.${SOURCE_REF_CLASS}`)).toBeNull();
    expect(container.textContent).toContain('[来源5]');
  });

  it('编号在 sourceCount 之内时正常生成按钮', () => {
    const container = renderToDom('[来源2]', { sourceCount: 2 });

    expect(container.querySelector(`.${SOURCE_REF_CLASS}`)).not.toBeNull();
  });

  it('不传 sourceCount 时不做越界判断', () => {
    const container = renderToDom('[来源99]');

    expect(container.querySelector(`.${SOURCE_REF_CLASS}`)).not.toBeNull();
  });

  it('sourceCount 为 0 时任何角标都退化', () => {
    const container = renderToDom('[来源1]', { sourceCount: 0 });

    expect(container.querySelector(`.${SOURCE_REF_CLASS}`)).toBeNull();
  });
});
