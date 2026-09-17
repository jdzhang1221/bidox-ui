<script lang="ts" setup>
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { BidAiModelApi } from '#/api/bid/ai-model';

import { onMounted, onUnmounted, ref } from 'vue';

import { Page, useVbenModal } from '@vben/common-ui';

import { Alert, Button, message, Tag } from 'antdv-next';

import { ACTION_ICON, TableAction, useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  applyAiModel,
  deleteAiModel,
  getAiModelPage,
  getSyncStatus,
  testAiModel,
} from '#/api/bid/ai-model';
import { $t } from '#/locales';

import { useGridColumns, useGridFormSchema } from './data';
import Form from './modules/form.vue';

const [FormModal, formModalApi] = useVbenModal({
  connectedComponent: Form,
  destroyOnClose: true,
});

// ==================== 同步状态 ====================

/**
 * 配置同步状态。
 *
 * v2 取消了常驻的「推送热生效」按钮 —— 保存 / 删除会在事务提交后自动推送，
 * 页面只需要回答一个问题：「现在生效了吗？」这个 ref 就是那个答案。
 */
const syncStatus = ref<BidAiModelApi.SyncStatus>({});
const applying = ref(false);
/** 轮询代次：新一轮轮询开始时让上一轮自行退出，避免连续保存叠加出并发轮询 */
let pollToken = 0;

/**
 * 拉取同步状态。
 *
 * 查询失败时**保守地当作「未生效」** —— 与后端 `BidAiModelSyncStatusRespVO` 的取向一致
 * （读不到 AI 版本时 `inSync` 同样是 false）：宁可让用户看到告警，也不谎报「已生效」。
 */
async function fetchSyncStatus() {
  try {
    syncStatus.value = await getSyncStatus();
  } catch {
    syncStatus.value = { inSync: false };
  }
}

const SYNC_POLL_TIMES = 3;
const SYNC_POLL_INTERVAL_MS = 500;

/**
 * 保存 / 删除成功后轮询同步状态。
 *
 * ⚠️ 必须轮询，不能只看写接口的响应：自动推送发生在**事务提交之后**
 * （`BidAiModelServiceImpl#registerAfterCommitPush`），响应发出时推送还没跑，
 * 所以响应里拿不到同步结果。拿到 `inSync === true` 就提前收工；
 * 3 次都没等到就停手，交给顶部 warning Alert 呈现「尚未生效 + 立即推送」。
 */
async function pollSyncStatus() {
  const token = ++pollToken;
  for (let i = 0; i < SYNC_POLL_TIMES; i += 1) {
    if (i > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, SYNC_POLL_INTERVAL_MS),
      );
    }
    if (token !== pollToken) {
      return;
    }
    await fetchSyncStatus();
    if (syncStatus.value.inSync) {
      flashSynced();
      return;
    }
  }
}

// ==================== 「刚刚生效」的瞬时确认 ====================

/** 绿色「配置已生效」的展示窗口（毫秒）—— 够看完，又不至于常驻占位 */
const SYNCED_FLASH_MS = 5000;

/**
 * 是否处于「刚刚确认生效」的窗口内。
 *
 * 稳态下**不显示**绿色标记：没有告警本身就等于「一切正常」，再挂一个常驻绿点只是噪音。
 * 真正需要正向反馈的时刻只有一个 —— 用户刚点完保存、列表刷新了，但界面除此之外毫无变化，
 * 这时他会怀疑「到底生效了没」。所以只在这个窗口里闪一下。
 */
const justSynced = ref(false);
let syncedTimer: ReturnType<typeof setTimeout> | undefined;

function flashSynced() {
  justSynced.value = true;
  clearTimeout(syncedTimer);
  syncedTimer = setTimeout(() => {
    justSynced.value = false;
  }, SYNCED_FLASH_MS);
}

onUnmounted(() => clearTimeout(syncedTimer));

// ==================== 行操作 ====================

/** 刷新表格 */
function handleRefresh() {
  gridApi.query();
}

/** 写操作（新增 / 修改 / 删除）之后的收尾：刷新列表 + 确认是否已生效 */
function handleMutated() {
  handleRefresh();
  pollSyncStatus();
}

/** 新增模型配置 */
function handleCreate() {
  formModalApi.setData(null).open();
}

/** 编辑模型配置 */
function handleEdit(row: BidAiModelApi.AiModel) {
  formModalApi.setData(row).open();
}

/** 删除模型配置 */
async function handleDelete(row: BidAiModelApi.AiModel) {
  const hideLoading = message.loading({
    content: $t('ui.actionMessage.deleting', [row.name]),
    duration: 0,
  });
  try {
    await deleteAiModel(row.id!);
    message.success($t('ui.actionMessage.deleteSuccess', [row.name]));
    handleMutated();
  } finally {
    hideLoading();
  }
}

/**
 * 测试连接。
 *
 * 「连不通」是正常返回值（ok=false），不是异常 —— 只有 AI 服务本身调不到才会抛。
 * 这里用 duration:0 的 loading 手动收尾，避免长耗时的探测留下一个自动消失的提示。
 */
async function handleTest(row: BidAiModelApi.AiModel) {
  const hideLoading = message.loading({
    content: `正在测试「${row.name}」…`,
    duration: 0,
  });
  try {
    // 只传 id / provider / model：baseUrl、apiKey、timeoutMs 由后端用库里已存的值补齐
    // （前端根本拿不到 apiKey，传了也是空）
    const result = await testAiModel({
      id: row.id,
      provider: row.provider,
      model: row.model,
    });
    if (result.ok) {
      message.success(`连接成功（${result.latencyMs}ms）`);
    } else {
      message.error(`连接失败：${result.message ?? '未知原因'}`);
    }
  } catch {
    // 「AI 服务本身调不到」走这里（Java 侧抛 AI_SETTINGS_TEST_FAILED）。
    // 不在这里再弹一次：全局 errorMessageResponseInterceptor 已经用后端 msg 提示过了，
    // 重复弹窗只会让用户看到两条一样的错误。
    // 这里 catch 掉是为了避免 unhandled rejection —— 它与 ok=false 是**两回事**：
    // ok=false 是「连不通」（正常返回值，上面已给出具体原因），异常是「测不了」。
  } finally {
    hideLoading();
  }
}

/**
 * 「立即推送」—— 自动推送失败后的人工补救。
 *
 * 这是 `POST /apply` 在页面上的**唯一入口**，正常情况下用户看不到它：
 * 只有 `inSync === false` 时才会随 warning Alert 一起出现。
 */
async function handleApply() {
  applying.value = true;
  try {
    await applyAiModel();
    message.success('已推送到 AI 服务，新配置立即生效（无需重启）');
    await fetchSyncStatus();
    if (syncStatus.value.inSync) {
      flashSynced();
    }
  } finally {
    applying.value = false;
  }
}

// ==================== 本租户是否真的配好了 ====================

/**
 * 当前租户是否有「启用中的行」。
 *
 * ⚠️ 这是 `inSync` **回答不了**的问题，别用 `inSync` 代替：
 * `inSync` 比的是**全局**版本号（`max(update_time)` ↔ AI 侧快照），
 * 而推送 payload 只收 `enabled = 1` 的行（`BidAiModelServiceImpl#buildModels`）。
 * 于是「零启用」的租户在 payload 里**直接缺席**、问答会报未配置，
 * 但 `inSync` 依然是 true —— 只看 `inSync` 就会显示绿色「配置已生效」骗用户。
 *
 * <p>v2.1 合并前这里判的是 `isDefault === 1 && status === 0` 两个条件，
 * 现在只剩一个 `enabled === 1`（极性是 1 = 启用，**不是** `CommonStatusEnum` 的 0 = 启用）。
 *
 * `null` = 列表还没回来，此时不提示任何东西（避免首次加载闪一下告警）。
 */
const hasEnabled = ref<boolean | null>(null);

const [Grid, gridApi] = useVbenVxeGrid({
  formOptions: {
    schema: useGridFormSchema(),
  },
  gridOptions: {
    columns: useGridColumns(),
    height: 'auto',
    keepSource: true,
    pagerConfig: {
      enabled: true,
    },
    proxyConfig: {
      ajax: {
        query: async ({ page }, formValues) => {
          const result = await getAiModelPage({
            pageNo: page.currentPage,
            pageSize: page.pageSize,
            ...formValues,
          });
          // 列表是本租户的，顺手算出「有没有正在用的模型」——
          // 不需要额外的接口，也不会因为分页漏判（一租户至多一条启用行）
          hasEnabled.value = (result?.list ?? []).some(
            (row) => row.enabled === 1,
          );
          return result;
        },
      },
    },
    rowConfig: {
      keyField: 'id',
      isHover: true,
    },
    toolbarConfig: {
      refresh: true,
      search: true,
    },
  } as VxeTableGridOptions<BidAiModelApi.AiModel>,
});

onMounted(() => {
  // 进页面先确认一次：上次保存可能推送失败，或 AI 服务重启后 overlay 已恢复
  fetchSyncStatus();
});
</script>

<template>
  <Page auto-content-height>
    <FormModal @success="handleMutated" />
    <Grid table-title="对话模型列表">
      <template #top>
        <Alert
          class="mb-3"
          type="info"
          show-icon
          message="本页管理当前租户的对话模型配置，未配置时知识问答与内容生成会直接报错。"
          description="当前操作的是哪个租户，由系统右上角的租户切换器决定。同一租户同时只能启用一条，启用新的一条会自动关闭原来的那条；保存后会自动推送到 AI 服务，无需重启。"
        />
        <!--
          本租户没配好（没有任何启用行）时优先提示这一条 —— 它比「尚未生效」更根本：
          这种状态下 AI 侧**根本拿不到**本租户的模型（payload 只收 enabled = 1 的行），
          而全局的 inSync 仍可能是 true。两者互斥展示，避免同一屏堆两条告警。
        -->
        <Alert
          v-if="hasEnabled === false"
          class="mb-3"
          type="warning"
          show-icon
          message="当前租户还没有可用的对话模型。"
          description="需要有一条「启用中」的配置，AI 侧才会拿到本租户的模型；否则知识问答会直接报错。"
        >
          <template #action>
            <Button
              v-access:code="['bid:ai-model:create']"
              type="primary"
              size="small"
              @click="handleCreate"
            >
              新增模型
            </Button>
          </template>
        </Alert>
        <Alert
          v-else-if="syncStatus.inSync === false"
          class="mb-3"
          type="warning"
          show-icon
          message="配置已保存，但尚未在 AI 服务上生效。"
        >
          <template #action>
            <Button
              v-access:code="['bid:ai-model:apply']"
              type="primary"
              size="small"
              :loading="applying"
              @click="handleApply"
            >
              立即推送
            </Button>
          </template>
        </Alert>
      </template>
      <!--
        左侧（紧挨标题）只放**状态**，右侧放**操作**。
        新增按钮必须走 `#toolbar-tools`：`toolbar-actions` 虽然也是上游合法槽位，
        但全仓只有本页在用，会让人感觉按钮「跑到左边去了」（其余 42 个 CRUD 页都在右侧）。
      -->
      <template #toolbar-actions>
        <!--
          只在**本租户确实有启用行**且版本一致、且刚保存完的窗口内才显示绿色。
          少了 `hasEnabled` 这一半，就会出现「本租户压根没配，页面却说配置已生效」；
          少了 `justSynced` 这一半，就会变成一个常驻绿点（稳态下纯属噪音）。
        -->
        <span
          v-if="justSynced && hasEnabled === true && syncStatus.inSync === true"
          class="ml-2 flex items-center gap-1 text-sm text-green-600"
        >
          <span
            class="inline-block h-2 w-2 rounded-full bg-green-500"
            aria-hidden="true"
          ></span>
          配置已生效
        </span>
      </template>
      <template #toolbar-tools>
        <TableAction
          :actions="[
            {
              label: $t('ui.actionTitle.create', ['模型配置']),
              type: 'primary',
              icon: ACTION_ICON.ADD,
              auth: ['bid:ai-model:create'],
              onClick: handleCreate,
            },
          ]"
        />
      </template>
      <!--
        合并后的「状态」列：两态一标签。
        合并前这里是「状态（CellDict）」+「默认（Tag）」两列，而两者的组合里
        只有「启用 + 默认」是有意义的（payload 只收这一种），其余三种是冗余或死状态。
      -->
      <template #enabled="{ row }">
        <Tag :color="row.enabled === 1 ? 'success' : 'default'">
          {{ row.enabled === 1 ? '启用中' : '未启用' }}
        </Tag>
      </template>
      <template #actions="{ row }">
        <TableAction
          :actions="[
            {
              label: '测试连接',
              type: 'link',
              auth: ['bid:ai-model:test'],
              onClick: handleTest.bind(null, row),
            },
            {
              label: $t('common.edit'),
              type: 'link',
              icon: ACTION_ICON.EDIT,
              auth: ['bid:ai-model:update'],
              onClick: handleEdit.bind(null, row),
            },
            {
              label: $t('common.delete'),
              type: 'link',
              danger: true,
              icon: ACTION_ICON.DELETE,
              auth: ['bid:ai-model:delete'],
              popConfirm: {
                title: $t('ui.actionMessage.deleteConfirm', [row.name]),
                confirm: handleDelete.bind(null, row),
              },
            },
          ]"
        />
      </template>
    </Grid>
  </Page>
</template>
