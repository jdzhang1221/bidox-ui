import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { BidAiModelApi } from '#/api/bid/ai-model';

import { DICT_TYPE } from '@vben/constants';
import { getDictOptions } from '@vben/hooks';

import { getRangePickerDefaultProps } from '#/utils';

/**
 * 提供方预设：切换提供方时回填 `baseUrl` / `model`。
 *
 * 取值与 AI 服务 `app/llm/gateway.py` 的 `_PROVIDER_URLS` / `_PROVIDER_MODELS`
 * 保持一致 —— 那边是「没显式配置时的兜底」，这里只是把它前置成表单默认值，
 * 避免用户选了 deepseek 还要自己记 baseUrl。
 *
 * `local`（进程内加载）与 `custom`（其他 OpenAI 兼容服务）**没有预设**：
 * 前者不需要 baseUrl，后者本来就得用户自己填，给个假默认值反而误导。
 */
export const PROVIDER_PRESET: Record<
  string,
  { baseUrl?: string; model?: string }
> = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-max',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
  },
};

/**
 * 新增/修改的表单（v2.1，10 个可见字段）。
 *
 * ⚠️ v2 相对 v1 删掉了三个字段，**不要加回来**：
 * - `tenantId`（作用域）→ 租户由系统右上角切换器决定，页面不显示、不传、不感知；
 * - `capability`（能力类型）→ 隐式 llm，本页只管对话模型；
 * - `dimension`（向量维度）→ embedding 不在本页，由 AI 服务 `.env` 提供。
 *
 * ⚠️ v2.1 把 `status`（RadioGroup）与 `isDefault`（Switch）合并成**一个** `enabled` Switch：
 * 两者原本是「必须同时满足才进 payload」的与关系，拆成两个控件只会让用户以为
 * 「启用但没勾默认」是有效组合 —— 那其实是个死状态（与停用等价）。
 * 合并后**不再有「设为默认」这个概念**：启用就是「本租户用它」。
 *
 * 保留的两条联动（都跟后端校验对应，删了会让用户白填一遍再吃 400）：
 * ① `provider` 变化 → 回填 `baseUrl` / `model`（见 `PROVIDER_PRESET`，实现在 `form.vue`）；
 * ② `apiKey` 编辑态 placeholder 变「留空表示不修改」—— 接口永不返回密钥。
 */
export function useFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'id',
      component: 'Input',
      dependencies: {
        triggerFields: [''],
        show: () => false,
      },
    },
    {
      fieldName: 'name',
      label: '名称',
      component: 'Input',
      componentProps: {
        placeholder: '请输入模型配置名称',
        maxLength: 128,
      },
      rules: 'required',
    },
    {
      fieldName: 'provider',
      label: '提供方',
      component: 'Select',
      componentProps: {
        options: getDictOptions(DICT_TYPE.BID_AI_MODEL_PROVIDER),
        placeholder: '请选择提供方',
      },
      rules: 'required',
      help: '切换提供方会自动回填推荐的服务地址与模型名',
    },
    {
      fieldName: 'model',
      label: '模型名',
      component: 'Input',
      componentProps: {
        placeholder: '如 deepseek-chat / gpt-4o',
        maxLength: 128,
      },
      rules: 'required',
    },
    {
      fieldName: 'baseUrl',
      label: '服务地址',
      component: 'Input',
      componentProps: {
        placeholder: '如 https://api.deepseek.com/v1',
        maxLength: 512,
      },
    },
    {
      fieldName: 'apiKey',
      label: 'API Key',
      component: 'InputPassword',
      componentProps: ({ rootValues }) => ({
        placeholder: rootValues?.id
          ? '留空表示不修改'
          : '本地推理（local / ollama）可留空',
        autocomplete: 'new-password',
      }),
      dependencies: {
        triggerFields: [''],
      },
    },
    {
      fieldName: 'temperature',
      label: '采样温度',
      component: 'InputNumber',
      componentProps: {
        class: '!w-full',
        min: 0,
        max: 2,
        step: 0.1,
        placeholder: '如 0.2',
      },
    },
    {
      fieldName: 'timeoutMs',
      label: '超时(毫秒)',
      component: 'InputNumber',
      componentProps: {
        class: '!w-full',
        min: 1000,
        placeholder: '留空用默认值',
      },
    },
    {
      fieldName: 'enabled',
      label: '启用',
      component: 'Switch',
      componentProps: {
        checkedValue: 1,
        unCheckedValue: 0,
      },
      help: '同一租户同时只能启用一条；启用本行会自动关闭原来启用的那条',
      defaultValue: 0,
    },
    {
      fieldName: 'sort',
      label: '排序',
      component: 'InputNumber',
      componentProps: {
        class: '!w-full',
        min: 0,
      },
      defaultValue: 0,
    },
    {
      fieldName: 'remark',
      label: '备注',
      component: 'TextArea',
      componentProps: {
        placeholder: '请输入备注',
        maxLength: 512,
        rows: 3,
      },
    },
  ];
}

/** 列表的搜索表单 */
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'name',
      label: '名称',
      component: 'Input',
      componentProps: {
        placeholder: '请输入名称',
        allowClear: true,
      },
    },
    {
      fieldName: 'provider',
      label: '提供方',
      component: 'Select',
      componentProps: {
        options: getDictOptions(DICT_TYPE.BID_AI_MODEL_PROVIDER),
        placeholder: '请选择提供方',
        allowClear: true,
      },
    },
    {
      fieldName: 'enabled',
      label: '状态',
      component: 'Select',
      componentProps: {
        // 字典 `bid_ai_model_status` 已随字段合并删除，这里的两个选项是**内联**的。
        // ⚠️ 值必须与后端 `enabled` 一致（1 = 启用），别照抄 CommonStatusEnum 的 0 = 启用。
        options: [
          { label: '启用中', value: 1 },
          { label: '未启用', value: 0 },
        ],
        placeholder: '请选择状态',
        allowClear: true,
      },
    },
    {
      fieldName: 'createTime',
      label: '创建时间',
      component: 'RangePicker',
      componentProps: {
        ...getRangePickerDefaultProps(),
        allowClear: true,
      },
    },
  ];
}

/**
 * 列表的字段。
 *
 * ⚠️ v2.1 把「状态」+「默认」两列合并成**一列**「状态」（两态：启用中 / 未启用）——
 * 合并前那两列的组合只有「启用+默认」是有意义的（payload 只收这一种），
 * 剩下三种组合里「启用+非默认」和「停用+非默认」对 AI 的影响完全相同，是纯冗余。
 * 合并后腾出的 70px 还给了文本列（`name` / `model` / `baseUrl`）。
 *
 * ⚠️ 列宽纪律（vxe 的三条铁律，改列时别破坏）：
 * ① 要固定必须写 `width` —— 只写 `minWidth` 会被按剩余空间等比撑大（编号声明 100 实测 173px）；
 * ② 原子列（编号 / 枚举 / 时间 / 操作）一律固定 `width`，剩余宽度只留给文本列；
 * ③ 表格全局 `align: 'center'`，文本列需显式 `align: 'left'`。
 */
export function useGridColumns(): VxeTableGridOptions<BidAiModelApi.AiModel>['columns'] {
  return [
    {
      field: 'id',
      title: '编号',
      width: 72,
    },
    {
      field: 'name',
      title: '名称',
      minWidth: 180,
      align: 'left',
      showOverflow: 'tooltip',
    },
    {
      field: 'provider',
      title: '提供方',
      width: 110,
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.BID_AI_MODEL_PROVIDER },
      },
    },
    {
      field: 'model',
      title: '模型名',
      minWidth: 180,
      align: 'left',
      showOverflow: 'tooltip',
    },
    {
      field: 'baseUrl',
      title: '服务地址',
      minWidth: 200,
      align: 'left',
      showOverflow: 'tooltip',
    },
    {
      field: 'enabled',
      title: '状态',
      // 两态标签：启用中（绿）/ 未启用（灰）。合并前这里是「状态 + 默认」两列，
      // 默认列还额外占 80px，而它表达的信息完全蕴含在「启用中」里。
      width: 100,
      slots: { default: 'enabled' },
    },
    {
      field: 'createTime',
      title: '创建时间',
      width: 170,
      formatter: 'formatDateTime',
    },
    {
      title: '操作',
      // 三个带图标按钮（测试连接 / 修改 / 删除），留足余量避免第 3 个按钮被裁掉
      width: 224,
      fixed: 'right',
      slots: { default: 'actions' },
    },
  ];
}
