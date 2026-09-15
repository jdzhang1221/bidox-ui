import type { Ref } from 'vue';

import { ref } from 'vue';

/**
 * 会话滚动管理（§5.10）
 *
 * <p>要同时满足三件互相拉扯的事，靠 `scrollTop = scrollHeight` 是做不到的：
 *
 * <ol>
 *   <li><b>新消息跟随</b>：只在用户**靠近底部**时才自动滚。用户正在往上翻历史时
 *       突然跳到最新，是最招人烦的交互之一。</li>
 *   <li><b>向上加载历史不跳动</b>：往列表顶部插入旧消息会把所有内容往下推，
 *       浏览器保持 `scrollTop` 不变，视觉上就是「内容突然跳走」。必须按
 *       「首个可见消息 + 像素偏移」补偿。</li>
 *   <li><b>加载历史期间禁止跟随</b>：补偿和跟随会互相打架 —— 跟随把滚动条拉到底，
 *       补偿又把它拉回锚点，结果闪两下。加载期间显式挂起跟随。</li>
 * </ol>
 *
 * <p>锚点用**本地消息键**（DOM 上的 `data-message-key`）而不是索引：加载历史时索引会整体后移。
 * 刻意不用服务端 `messageId` —— 用户刚发出的消息在 `meta` 到达前还没有服务端编号，
 * 而那一刻正是最容易触发锚点补偿的时刻。
 */

/** 认为「贴近底部」的像素阈值 */
const NEAR_BOTTOM_THRESHOLD_PX = 80;

interface ScrollAnchor {
  /** 锚点消息的本地键（`data-message-key`），在列表增删时保持稳定 */
  key: string;
  /** 锚点元素顶边相对滚动容器顶边的偏移 */
  offsetTop: number;
}

export function useChatScroll(containerRef: Ref<HTMLElement | undefined>) {
  /** 用户是否贴近底部（决定要不要自动跟随） */
  const isNearBottom = ref(true);
  /** 是否正在加载历史。为 true 时挂起底部跟随 */
  const isLoadingHistory = ref(false);

  function onScroll(): void {
    const el = containerRef.value;
    if (!el) {
      return;
    }
    isNearBottom.value =
      el.scrollHeight - el.scrollTop - el.clientHeight <=
      NEAR_BOTTOM_THRESHOLD_PX;
  }

  /** 滚到底部。`smooth` 用于终态/新消息，`auto` 用于首屏与锚点恢复 */
  function scrollToBottom(behavior: ScrollBehavior = 'smooth'): void {
    const el = containerRef.value;
    if (!el) {
      return;
    }
    el.scrollTo({ behavior, top: el.scrollHeight });
    isNearBottom.value = true;
  }

  /** 仅在用户贴近底部时跟随 */
  function followIfNearBottom(behavior: ScrollBehavior = 'smooth'): void {
    if (isNearBottom.value) {
      scrollToBottom(behavior);
    }
  }

  /**
   * 记录当前滚动锚点（prepend 之前调用）。
   *
   * @returns 无可见消息时返回 `null`，调用方应跳过恢复
   */
  function captureAnchor(): null | ScrollAnchor {
    const el = containerRef.value;
    if (!el) {
      return null;
    }
    const containerTop = el.getBoundingClientRect().top;
    const nodes = el.querySelectorAll<HTMLElement>('[data-message-key]');
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      // 第一个「底边还没滚出容器顶部」的元素就是视觉锚点
      if (rect.bottom > containerTop) {
        const key = node.dataset.messageKey;
        return key ? { key, offsetTop: rect.top - containerTop } : null;
      }
    }
    return null;
  }

  /**
   * 恢复滚动锚点（prepend 之后、`nextTick` 里调用）。
   *
   * 用「新位置 − 记录位置」的差值直接补偿 `scrollTop`，不需要知道插入了多少内容。
   */
  function restoreAnchor(anchor: null | ScrollAnchor): void {
    const el = containerRef.value;
    if (!el || !anchor) {
      return;
    }
    const node = el.querySelector<HTMLElement>(
      `[data-message-key="${CSS.escape(anchor.key)}"]`,
    );
    if (!node) {
      return;
    }
    const containerTop = el.getBoundingClientRect().top;
    const currentOffsetTop = node.getBoundingClientRect().top - containerTop;
    el.scrollTop += currentOffsetTop - anchor.offsetTop;
  }

  /**
   * 包一次「加载历史」：挂起跟随 → 执行 → 恢复锚点 → 解除挂起。
   *
   * 恢复放在 `nextTick` 之后由调用方保证（Vue 需要一次 patch 才能量到新位置），
   * 所以这里把 `restoreAnchor` 交给调用方在 `nextTick` 中执行。
   */
  function beginHistoryLoad(): null | ScrollAnchor {
    isLoadingHistory.value = true;
    return captureAnchor();
  }

  function endHistoryLoad(anchor: null | ScrollAnchor): void {
    restoreAnchor(anchor);
    isLoadingHistory.value = false;
  }

  return {
    beginHistoryLoad,
    captureAnchor,
    endHistoryLoad,
    followIfNearBottom,
    isNearBottom,
    isLoadingHistory,
    onScroll,
    restoreAnchor,
    scrollToBottom,
  };
}
