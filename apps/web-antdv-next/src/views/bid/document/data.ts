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
      minWidth: 80,
    },
    {
      field: 'displayName',
      title: '文档名称',
      minWidth: 200,
      showOverflow: 'tooltip',
    },
    {
      field: 'documentType',
      title: '文档类型',
      minWidth: 120,
      formatter: ({ cellValue }) => documentTypeText[cellValue] ?? cellValue,
    },
    {
      field: '_knowledgeBaseName',
      title: '知识库',
      minWidth: 120,
      formatter: ({ row }) => (row as any)._knowledgeBaseName ?? '-',
    },
    {
      field: '_parseStatus',
      title: '解析状态',
      minWidth: 120,
      slots: { default: 'parseStatus' },
    },
    {
      field: 'createTime',
      title: '创建时间',
      minWidth: 180,
      formatter: 'formatDateTime',
    },
    {
      title: '操作',
      width: 220,
      fixed: 'right',
      slots: { default: 'actions' },
    },
  ];
}

/** 解析日志列表字段 */
export function useParseLogColumns(): VxeTableGridOptions['columns'] {
  return [
    {
      field: 'attemptNo',
      title: '解析次数',
      minWidth: 80,
    },
    {
      field: 'status',
      title: '状态',
      minWidth: 100,
      slots: { default: 'logStatus' },
    },
    {
      field: 'parser',
      title: '解析器',
      minWidth: 100,
    },
    {
      field: 'blockCount',
      title: 'Block 数',
      minWidth: 90,
    },
    {
      field: 'sectionCount',
      title: 'Section 数',
      minWidth: 90,
    },
    {
      field: 'chunkCount',
      title: 'Chunk 数',
      minWidth: 90,
    },
    {
      field: 'patternCount',
      title: 'Pattern 数',
      minWidth: 90,
    },
    {
      field: 'duration',
      title: '耗时(ms)',
      minWidth: 100,
    },
    {
      field: 'beginTime',
      title: '开始时间',
      minWidth: 180,
      formatter: 'formatDateTime',
    },
    {
      field: 'endTime',
      title: '结束时间',
      minWidth: 180,
      formatter: 'formatDateTime',
    },
    {
      field: 'errorMessage',
      title: '错误信息',
      minWidth: 200,
      showOverflow: 'tooltip',
    },
  ];
}
