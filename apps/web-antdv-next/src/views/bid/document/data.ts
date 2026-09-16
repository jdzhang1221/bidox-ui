import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { BidDocumentApi } from '#/api/bid/document';

import { getKnowledgeBaseSimpleList } from '#/api/bid/knowledge-base';

/**
 * 文档类型选项。
 *
 * 注意 `tender`（不是 `tender_doc`）：早期字典里写的是 `tender_doc`，与 Java
 * `DocumentTypeEnum.TENDER` / Python 侧的 `tender` 不一致，导致「按类型排除招标文件」
 * 的过滤在存量数据上静默失效。已在 `bidox-bid-dict.sql` 中做幂等收敛。
 */
export const documentTypeOptions = [
  { label: '历史标书', value: 'historical_bid' },
  { label: '招标文件', value: 'tender' },
];

/** 解析状态选项 */
export const parseStatusOptions = [
  { label: '等待中', value: 0 },
  { label: '解析中', value: 1 },
  { label: '成功', value: 2 },
  { label: '失败', value: 3 },
  { label: '已中断', value: 4 },
];

/** 解析状态 → Tag 颜色映射 */
export const parseStatusTagType: Record<
  number,
  'default' | 'error' | 'processing' | 'success' | 'warning'
> = {
  0: 'default',
  1: 'processing',
  2: 'success',
  3: 'error',
  4: 'warning',
};

/** 解析状态 → 文本映射 */
export const parseStatusText: Record<number, string> = {
  0: '等待中',
  1: '解析中',
  2: '成功',
  3: '失败',
  4: '已中断',
};

/** 文档类型 → 文本映射（含历史遗留值 tender_doc，避免老数据展示为空） */
export const documentTypeText: Record<string, string> = {
  historical_bid: '历史标书',
  tender: '招标文件',
  tender_doc: '招标文件',
};

/** 上传表单 */
export function useUploadFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'knowledgeBaseId',
      label: '知识库',
      component: 'ApiSelect',
      // ApiComponent 自身 v-model 名为 modelValue；不显式声明会导致表单收不到回写值
      modelPropName: 'modelValue',
      componentProps: {
        api: getKnowledgeBaseSimpleList,
        labelField: 'name',
        valueField: 'id',
        placeholder: '请选择知识库',
        allowClear: false,
      },
      rules: 'selectRequired',
    },
    {
      fieldName: 'displayName',
      label: '文档名称',
      component: 'Input',
      componentProps: {
        placeholder: '请输入文档名称',
        maxLength: 255,
      },
      rules: 'required',
    },
    {
      fieldName: 'documentType',
      label: '文档类型',
      component: 'Select',
      componentProps: {
        options: documentTypeOptions,
        placeholder: '请选择文档类型',
        allowClear: false,
      },
      rules: 'selectRequired',
    },
  ];
}

/** 列表搜索表单 */
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'knowledgeBaseId',
      label: '知识库',
      component: 'ApiSelect',
      // 同上：显式声明 modelValue，保证搜索表单能正确回写
      modelPropName: 'modelValue',
      componentProps: {
        api: getKnowledgeBaseSimpleList,
        labelField: 'name',
        valueField: 'id',
        placeholder: '请选择知识库',
        allowClear: true,
      },
    },
    {
      fieldName: 'displayName',
      label: '文档名称',
      component: 'Input',
      componentProps: {
        placeholder: '请输入文档名称',
        allowClear: true,
      },
    },
    {
      fieldName: 'documentType',
      label: '文档类型',
      component: 'Select',
      componentProps: {
        options: documentTypeOptions,
        placeholder: '请选择文档类型',
        allowClear: true,
      },
    },
    {
      // 多选：请求客户端默认 paramsSerializer='repeat'，
      // 会序列化成 parseStatuses=2&parseStatuses=3，正好对应后端 List<Integer>
      fieldName: 'parseStatuses',
      label: '解析状态',
      component: 'Select',
      componentProps: {
        options: parseStatusOptions,
        mode: 'multiple',
        placeholder: '请选择解析状态',
        allowClear: true,
      },
    },
  ];
}

/** 列表字段 */
export function useGridColumns(): VxeTableGridOptions<BidDocumentApi.Document>['columns'] {
  return [
    { type: 'checkbox', width: 40 },
    {
      field: 'id',
      title: '编号',
      // ⚠️ 固定宽度（不是 minWidth）：minWidth 会被 vxe 按剩余空间撑大，
      // 既浪费横向空间，又会把「操作」列挤出可视区。编号只需容纳 4 位数。
      width: 72,
    },
    {
      field: 'displayName',
      title: '文档名称',
      minWidth: 200,
      // 文本列左对齐，便于纵向扫读（表格全局默认 align 为 center）
      align: 'left',
      showOverflow: 'tooltip',
    },
    {
      field: 'documentType',
      title: '文档类型',
      // 原子列（枚举）：固定宽。写 minWidth 会被 vxe 按剩余空间撑大 —— 实测
      // 声明 120 却占 156px，而多出来的宽度本该给下面的文本列。
      width: 110,
      formatter: ({ cellValue }) => documentTypeText[cellValue] ?? cellValue,
    },
    {
      field: '_knowledgeBaseName',
      title: '知识库',
      // 变长文本列：吸收剩余宽度（原先 176px 会把「MVP服务联调知识库-20260914」截断）
      minWidth: 130,
      align: 'left',
      showOverflow: 'tooltip',
      formatter: ({ row }) => (row as any)._knowledgeBaseName ?? '-',
    },
    {
      field: '_parseStatus',
      title: '解析状态',
      // 原子列：只放一个 Tag，固定宽
      width: 100,
      slots: { default: 'parseStatus' },
    },
    {
      field: 'createTime',
      title: '创建时间',
      // 原子列：定长日期时间，固定宽（实测被撑到 217px）
      width: 170,
      formatter: 'formatDateTime',
    },
    {
      title: '操作',
      // ⚠️ 必须 ≥271px：三个带图标的文字按钮（开始解析 / 解析日志 / 删除）实测内容宽 259px，
      // 原值 220px 会让「删除」越过表格右边界被 overflow:hidden 裁掉，用户看不到。
      // 这里留 13px 余量，避免文案或图标微调后再次贴边。
      width: 272,
      fixed: 'right',
      slots: { default: 'actions' },
    },
  ];
}

/**
 * 解析日志列表字段。
 *
 * ⚠️ 这里是**唯一**必须用固定 `width` 的表：抽屉容器最窄、列数最多。
 * 全部写 `minWidth` 时 11 列合计 1300px，而抽屉只有 520px —— 实测用户
 * 只能看到前 5 列，「错误信息」要横向滚过 6 列才看得到（解析失败时最需要它）。
 *
 * 两条收敛原则：
 * 1. **原子列一律固定宽**（次数 / 状态 / 解析器 / 各项计数 / 耗时 / 时间）。
 *    它们是枚举或定长数字，宽度不该随容器伸缩；只有「错误信息」是变长文本，
 *    用 `minWidth` 吸收剩余宽度。
 * 2. **删掉「结束时间」**。它等于 `开始时间 + 耗时`，属纯派生值；
 *    留着会多占 180px 并再次把表格挤出抽屉。需要精确起止时看开始时间与耗时即可。
 */
export function useParseLogColumns(): VxeTableGridOptions['columns'] {
  return [
    {
      field: 'attemptNo',
      title: '解析次数',
      width: 84,
    },
    {
      field: 'status',
      title: '状态',
      width: 92,
      slots: { default: 'logStatus' },
    },
    {
      field: 'parser',
      title: '解析器',
      width: 92,
      align: 'left',
    },
    {
      field: 'blockCount',
      title: 'Block 数',
      width: 86,
    },
    {
      field: 'sectionCount',
      title: 'Section 数',
      width: 92,
    },
    {
      field: 'chunkCount',
      title: 'Chunk 数',
      width: 88,
    },
    {
      field: 'patternCount',
      title: 'Pattern 数',
      width: 92,
    },
    {
      field: 'duration',
      title: '耗时(ms)',
      width: 96,
    },
    {
      field: 'beginTime',
      title: '开始时间',
      width: 168,
      formatter: 'formatDateTime',
    },
    {
      field: 'errorMessage',
      title: '错误信息',
      // 唯一变长列：吸收剩余宽度，超出用 tooltip 展示
      minWidth: 220,
      align: 'left',
      showOverflow: 'tooltip',
    },
  ];
}
