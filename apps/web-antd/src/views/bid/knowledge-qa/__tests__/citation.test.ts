import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '#/components/markdown-view';

import { extractCitedIndexes, resolveCitedSources } from '../citation';

/**
 * 引用来源收敛回归（§5.8 展示层）
 *
 * 需求：聊天回复的引用来源**只显示被答案引用的那些**。
 *
 * 这里锁死两个最容易写错、错了又很难发现的不变量：
 *
 * 1. **编号保留原始证据编号**。收敛后列表可能是「来源2、来源4」，
 *    绝不能重排成「1、2」—— 正文角标点击是按 N 定位的，
 *    重编号会让用户点 `[来源4]` 跳到另一条来源上（数据没错、但指向错了）。
 * 2. **与 `render.ts` 的角标模式严格一致**。两边一旦漂移，会出现
 *    「角标点得开、来源列表里没有」或「列表里有、角标点不动」这类错位。
 */

function source(documentId: number) {
  return { documentId, snippet: `片段${documentId}` };
}

describe('extractCitedIndexes', () => {
  it('提取并按升序去重', () => {
    expect(
      extractCitedIndexes('结论A [来源2]。结论B [来源1][来源2]', 5),
    ).toEqual([1, 2]);
  });

  it('丢弃越界编号（模型可能抄上一轮角标）', () => {
    expect(extractCitedIndexes('[来源1][来源9]', 5)).toEqual([1]);
    expect(extractCitedIndexes('[来源9]', 5)).toEqual([]);
  });

  it('丢弃 0 与非正整数', () => {
    expect(extractCitedIndexes('[来源0]', 5)).toEqual([]);
  });

  it('只认 1~3 位数字，四位不匹配', () => {
    expect(extractCitedIndexes('[来源1234]', 5)).toEqual([]);
    expect(extractCitedIndexes('[来源123]', 200)).toEqual([123]);
  });

  it('不误匹配形近文本', () => {
    expect(extractCitedIndexes('来源1、[来源]、[出处1]、来源(1)', 5)).toEqual(
      [],
    );
  });

  it('空内容与空来源返回空数组', () => {
    expect(extractCitedIndexes('', 5)).toEqual([]);
    expect(extractCitedIndexes(null, 5)).toEqual([]);
    expect(extractCitedIndexes('[来源1]', 0)).toEqual([]);
  });

  it('跨行正文也能提取', () => {
    expect(extractCitedIndexes('第一段 [来源1]\n\n第二段 [来源3]', 5)).toEqual([
      1, 3,
    ]);
  });
});

describe('resolveCitedSources', () => {
  const sources = [source(11), source(12), source(13), source(14), source(15)];

  it('只返回被引用的来源，且编号保留原始值', () => {
    const view = resolveCitedSources('答案 [来源2] 与 [来源4]', sources);
    expect(view.filtered).toBe(true);
    expect(view.citedCount).toBe(2);
    expect(view.recalledCount).toBe(5);
    // 关键：编号是 2、4，不是 1、2
    expect(view.entries.map((entry) => entry.index)).toEqual([2, 4]);
    // 且指向的是原始数组里对应的那两条
    expect(view.entries[0]!.source).toBe(sources[1]);
    expect(view.entries[1]!.source).toBe(sources[3]);
  });

  it('没有任何引用标记时回退全量（漏掉真实依据比多显示几条严重）', () => {
    const view = resolveCitedSources('这段回答没有标注来源。', sources);
    expect(view.filtered).toBe(false);
    expect(view.citedCount).toBe(0);
    expect(view.recalledCount).toBe(5);
    expect(view.entries.map((entry) => entry.index)).toEqual([1, 2, 3, 4, 5]);
  });

  it('全部被引用时不隐藏任何条目', () => {
    const view = resolveCitedSources(
      '[来源1][来源2][来源3][来源4][来源5]',
      sources,
    );
    expect(view.filtered).toBe(true);
    expect(view.entries).toHaveLength(5);
    expect(view.citedCount).toBe(view.recalledCount);
  });

  it('引用全部越界时同样回退全量', () => {
    const view = resolveCitedSources('[来源9]', sources);
    expect(view.filtered).toBe(false);
    expect(view.entries).toHaveLength(5);
  });

  it('无召回来源时返回空', () => {
    const view = resolveCitedSources('[来源1]', []);
    expect(view.entries).toEqual([]);
    expect(view.recalledCount).toBe(0);
  });
});

describe('与正文角标的一致性', () => {
  it('能被收敛进列表的编号，正文里一定渲染成了可点击角标', () => {
    const content = '甲 [来源1] 乙 [来源3] 丙 [来源7]';
    const sourceCount = 5;
    const html = renderMarkdown(content, { sourceCount });
    const renderedIndexes = [...html.matchAll(/data-source-index="(\d+)"/gu)]
      .map((match) => Number(match[1]))
      .toSorted((a, b) => a - b);
    // 收敛结果（7 越界被丢弃）必须与正文实际生成的角标完全一致
    expect(extractCitedIndexes(content, sourceCount)).toEqual(renderedIndexes);
  });
});
