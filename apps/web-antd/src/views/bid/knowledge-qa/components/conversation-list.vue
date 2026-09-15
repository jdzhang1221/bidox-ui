<script lang="ts" setup>
import type { BidKnowledgeQaApi } from '#/api/bid/knowledge-qa';

import { ref, watch } from 'vue';

import { Button, Input, message, Popconfirm } from 'ant-design-vue';

import {
  deleteConversation,
  getConversationPage,
  updateConversation,
} from '#/api/bid/knowledge-qa';

/**
 * 会话列表
 *
 * 三个刻意的设计：
 *
 * 1. **分页而不是全量**。会话数量随时间线性增长，一次拉全量会让首屏越来越慢。
 *    这里用「加载更多」而非滚动加载，是为了不和消息区的滚动锚点逻辑抢事件。
 * 2. **重命名用内联编辑**，不用弹窗：弹窗会遮住会话标题的上下文，
 *    而改名恰恰需要对着标题改。
 * 3. **删除前先收敛活动回答**（服务端行为）：删除一个正在生成的会话，
 *    服务端会先 CANCEL 再逻辑删除，因此本地必须等接口返回后再移除，
 *    不能乐观删除 —— 否则接口失败时列表和真实数据不一致。
 */
const props = withDefaults(
  defineProps<{
    activeId: null | number;
    /**
     * 刷新信号：自增即重新拉取第一页。
     *
     * 用「信号 prop」而不是 `defineExpose` 暴露 `reload()`：父组件就不需要为模板 ref
     * 维护类型断言，而且信号在 `v-if` 反复挂载/卸载时同样可靠
     * （模板 ref 在卸载后是 `null`，很容易写出「有时不刷新」的 bug）。
     */
    reloadToken?: number;
  }>(),
  { reloadToken: 0 },
);

const emit = defineEmits<{
  create: [];
  removed: [id: number];
  select: [id: number];
}>();

const PAGE_SIZE = 20;

const list = ref<BidKnowledgeQaApi.Conversation[]>([]);
const total = ref(0);
const pageNo = ref(1);
const loading = ref(false);
/** 首次加载完成前不展示空状态，否则会闪一下「暂无会话」 */
const loaded = ref(false);

const renamingId = ref<null | number>(null);
const renameText = ref('');

async function load(reset = false): Promise<void> {
  if (loading.value) {
    return;
  }
  loading.value = true;
  try {
    const current = reset ? 1 : pageNo.value;
    const page = await getConversationPage({
      pageNo: current,
      pageSize: PAGE_SIZE,
    });
    const records = page?.list ?? [];
    list.value = reset ? records : [...list.value, ...records];
    total.value = page?.total ?? list.value.length;
    pageNo.value = current + 1;
    loaded.value = true;
  } catch {
    // 错误提示由 requestClient 的拦截器统一处理，这里只需保证 loaded 置位
    loaded.value = true;
  } finally {
    loading.value = false;
  }
}

const hasMore = () => list.value.length < total.value;

function startRename(item: BidKnowledgeQaApi.Conversation): void {
  if (item.id === undefined || item.id === null) {
    return;
  }
  renamingId.value = item.id;
  renameText.value = item.title;
}

function cancelRename(): void {
  renamingId.value = null;
  renameText.value = '';
}

async function confirmRename(
  item: BidKnowledgeQaApi.Conversation,
): Promise<void> {
  const id = item.id;
  const title = renameText.value.trim();
  if (id === undefined || id === null) {
    return;
  }
  if (title === '') {
    message.warning('会话标题不能为空');
    return;
  }
  if (title === item.title) {
    cancelRename();
    return;
  }
  try {
    await updateConversation({ id, title });
    item.title = title;
    cancelRename();
  } catch {
    // 保持编辑态，让用户可以直接重试
  }
}

async function handleDelete(
  item: BidKnowledgeQaApi.Conversation,
): Promise<void> {
  const id = item.id;
  if (id === undefined || id === null) {
    return;
  }
  try {
    await deleteConversation(id);
    list.value = list.value.filter((one) => one.id !== id);
    total.value = Math.max(0, total.value - 1);
    emit('removed', id);
  } catch {
    // 拦截器已提示；列表保持原样，避免与真实数据不一致
  }
}

/**
 * 重新加载第一页。
 *
 * 新建会话必须**重置到第一页**：新会话按最后消息时间排序在最前，
 * 不重置的话用户看不到它。
 */
async function reload(): Promise<void> {
  pageNo.value = 1;
  await load(true);
}

// 外部要求刷新（首问创建了会话、或回答完成改变了排序）
watch(
  () => props.reloadToken,
  () => {
    void reload();
  },
);

load(true);
</script>

<template>
  <div class="qa-conversations">
    <div class="qa-conversations__header">
      <Button block type="primary" @click="emit('create')">＋ 新对话</Button>
    </div>

    <div class="qa-conversations__body">
      <p v-if="loaded && list.length === 0" class="qa-conversations__empty">
        暂无历史会话
      </p>

      <div
        v-for="item in list"
        :key="item.id ?? item.title"
        class="qa-conversations__item"
        :class="{ 'is-active': item.id != null && item.id === props.activeId }"
      >
        <template v-if="renamingId === item.id">
          <Input
            v-model:value="renameText"
            size="small"
            @press-enter="confirmRename(item)"
          />
          <div class="qa-conversations__rename-actions">
            <Button size="small" type="link" @click="confirmRename(item)">
              确定
            </Button>
            <Button size="small" type="link" @click="cancelRename">取消</Button>
          </div>
        </template>

        <template v-else>
          <button
            class="qa-conversations__title"
            type="button"
            @click="item.id != null && emit('select', item.id)"
          >
            {{ item.title || '未命名会话' }}
          </button>
          <div class="qa-conversations__actions">
            <Button size="small" type="link" @click="startRename(item)">
              重命名
            </Button>
            <Popconfirm
              cancel-text="取消"
              ok-text="删除"
              title="删除该会话？删除后不可恢复"
              @confirm="handleDelete(item)"
            >
              <Button danger size="small" type="link">删除</Button>
            </Popconfirm>
          </div>
        </template>
      </div>

      <div v-if="hasMore()" class="qa-conversations__more">
        <Button
          :loading="loading"
          size="small"
          type="link"
          @click="load(false)"
        >
          加载更多
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qa-conversations {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-right: 1px solid hsl(var(--border));
}

.qa-conversations__header {
  padding: 12px;
}

.qa-conversations__body {
  flex: 1;
  padding: 0 8px 12px;
  overflow-y: auto;
}

.qa-conversations__empty {
  padding: 12px;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  text-align: center;
}

.qa-conversations__item {
  padding: 7px 9px;
  margin-bottom: 3px;
  border-radius: 6px;
  transition: background-color 0.15s ease;
}

.qa-conversations__item:hover {
  background: hsl(var(--accent));
}

/* 当前会话：左侧主色条 + 主色浅底，长列表里一眼能定位 */
.qa-conversations__item.is-active {
  background: hsl(var(--primary) / 8%);
  box-shadow: inset 2px 0 0 hsl(var(--primary));
}

.qa-conversations__title {
  display: block;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  color: hsl(var(--foreground));
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  border: none;
}

.qa-conversations__actions {
  display: flex;
  gap: 2px;
  margin-top: 2px;
}

/**
 * 操作按钮默认隐藏，悬停或选中时浮现，避免每行都挂两个链接把列表压得很吵。
 *
 * 用 `@media (hover: hover)` 圈起来：触摸设备没有 hover，
 * 若在那里也隐藏，重命名与删除将永远无法触达。
 */
@media (hover: hover) {
  .qa-conversations__actions {
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .qa-conversations__item:hover .qa-conversations__actions,
  .qa-conversations__item.is-active .qa-conversations__actions {
    opacity: 1;
  }
}

.qa-conversations__rename-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 2px;
}

.qa-conversations__more {
  text-align: center;
}
</style>
