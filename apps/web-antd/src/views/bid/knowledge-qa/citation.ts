import type { BidKnowledgeQaApi } from '#/api/bid/knowledge-qa';

import { SOURCE_REF_PATTERN } from '#/components/markdown-view';

/**
 * 「哪些来源真的被答案引用了」（§5.8 展示层收敛）
 *
 * 背景：`sources` 是**检索召回**的结果（通常 5 条），而答案往往只用到其中一两条。
 * 实测一轮：「投标保证金和投标有效期分别是多少？」召回 5 条，答案只引用了
 * `[来源1][来源2]` —— 另外 3 条是纯噪音，把它们平铺出来会让用户以为答案有 5 处依据。
 *
 * 判定依据是 Python 侧 prompt 的硬约定（`app/knowledge/qa_prompt.py`）：
 * 「每个事实结论用 `[来源N]` 标注，N 对应证据编号」。
 * 证据编号由 `enumerate(results, 1)` 生成，与回传的 `sources` 严格同序同长，
 * 因此 `[来源N]` ↔ `sources[N - 1]`。
 *
 * ## 两条不能省的规则
 *
 * 1. **编号必须保留原始值**。收敛后列表里可能是「来源2、来源4」，
 *    绝不能重新从 1 编号 —— 正文角标点击是按 `N` 定位的，重编号会让用户
 *    点 `[来源4]` 却跳到另一条。
 * 2. **没有引用标记时回退显示全部**。模型可能整段不标注（或标注格式跑偏），
 *    此时「无法判断」不等于「一条都没用」。回退到全部是唯一安全的兜底：
 *    漏掉真实依据比多显示几条严重得多。界面会同时说明这是未收敛的全量。
 */

/** 全局扫描用。`matchAll` 会克隆正则并重置 `lastIndex`，模块级 `g` 正则不会串状态。 */
const SOURCE_REF_GLOBAL_RE = new RegExp(SOURCE_REF_PATTERN, 'gu');

/** 列表条目：`index` 是**原始证据编号**（1 起），不是数组下标 */
export interface CitedSourceEntry {
  index: number;
  source: BidKnowledgeQaApi.Source;
}

export interface CitedSourceView {
  /** 被引用到的来源，按原始编号升序 */
  entries: CitedSourceEntry[];
  /** 被引用的条数 */
  citedCount: number;
  /** 检索召回的条数（未收敛前的总数） */
  recalledCount: number;
  /**
   * 是否真的按引用收敛过。
   *
   * `false` 表示答案里没有任何可识别的 `[来源N]`，`entries` 是**全量兜底**，
   * 界面需要据此换文案，避免把「未标注」说成「都引用了」。
   */
  filtered: boolean;
}

/**
 * 从答案正文提取被引用的证据编号。
 *
 * @param sourceCount 本轮可用来源总数。越界的编号（模型把上一轮角标抄进本轮）
 *   一律丢弃 —— 与 `render.ts` 把越界角标降级为纯文本的策略保持一致，
 *   否则会出现「正文里那串字点不动，来源列表里却多一条」的错位。
 * @returns 去重且升序的编号；无标记时返回空数组
 */
export function extractCitedIndexes(
  content: null | string | undefined,
  sourceCount: number,
): number[] {
  const text = content ?? '';
  if (text === '' || sourceCount <= 0) {
    return [];
  }
  const found = new Set<number>();
  for (const match of text.matchAll(SOURCE_REF_GLOBAL_RE)) {
    const index = Number(match[1]);
    if (Number.isInteger(index) && index >= 1 && index <= sourceCount) {
      found.add(index);
    }
  }
  return [...found].toSorted((a, b) => a - b);
}

/**
 * 把召回来源收敛成「实际被引用的那些」。
 *
 * 收敛后为空则回退全量，见文件头的规则 2。
 */
export function resolveCitedSources(
  content: null | string | undefined,
  sources: BidKnowledgeQaApi.Source[] | undefined,
): CitedSourceView {
  const list = sources ?? [];
  const recalledCount = list.length;
  if (recalledCount === 0) {
    return { citedCount: 0, entries: [], filtered: false, recalledCount: 0 };
  }
  const citedIndexes = extractCitedIndexes(content, recalledCount);
  if (citedIndexes.length === 0) {
    return {
      citedCount: 0,
      entries: list.map((source, offset) => ({ index: offset + 1, source })),
      filtered: false,
      recalledCount,
    };
  }
  return {
    citedCount: citedIndexes.length,
    entries: citedIndexes.map((index) => ({
      index,
      source: list[index - 1]!,
    })),
    filtered: true,
    recalledCount,
  };
}
