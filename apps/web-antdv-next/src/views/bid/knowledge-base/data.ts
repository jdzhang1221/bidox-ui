import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { BidKnowledgeBaseApi } from '#/api/bid/knowledge-base';

import { DICT_TYPE } from '@vben/constants';

import { getRangePickerDefaultProps } from '#/utils';

/** 新增/修改的表单 */
export function useFormSchema(): VbenFormSchema[] {
  return [
    {
      component: 'Input',
      fieldName: 'id',
      dependencies: {
        triggerFields: [''],
        show: () => false,
      },
    },
    {
      fieldName: 'name',
      label: '知识库名称',
      component: 'Input',
      componentProps: {
        placeholder: '请输入知识库名称',
        maxLength: 128,
      },
      rules: 'required',
    },
    {
      fieldName: 'description',
      label: '知识库描述',
      component: 'TextArea',
      componentProps: {
        placeholder: '请输入知识库描述',
        maxLength: 1024,
        rows: 3,
      },
    },
    {
      fieldName: 'status',
      label: '状态',
      component: 'RadioGroup',
      componentProps: {
        options: [
          { label: '启用', value: 0 },
          { label: '停用', value: 1 },
        ],
        buttonStyle: 'solid',
        optionType: 'button',
      },
      defaultValue: 0,
      rules: 'required',
    },
  ];
}

/** 列表的搜索表单 */
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'name',
      label: '知识库名称',
      component: 'Input',
      componentProps: {
        placeholder: '请输入知识库名称',
        allowClear: true,
      },
    },
    {
      fieldName: 'status',
      label: '状态',
      component: 'Select',
      componentProps: {
        options: [
          { label: '启用', value: 0 },
          { label: '停用', value: 1 },
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

/** 列表的字段 */
export function useGridColumns(): VxeTableGridOptions<BidKnowledgeBaseApi.KnowledgeBase>['columns'] {
  return [
    {
      field: 'id',
      title: '编号',
      // ⚠️ 用固定 `width` 而不是 `minWidth`：表格全局 align 为 center，vxe 会把
      // 「minWidth 列」按剩余空间等比撑大，两位数编号实测占过 173px。固定后不再随窗口变化。
      width: 72,
    },
    {
      field: 'name',
      title: '知识库名称',
      // 变长文本列：吸收剩余宽度
      minWidth: 200,
      // 文本列左对齐，便于纵向扫读（全局默认是 center）
      align: 'left',
      showOverflow: 'tooltip',
    },
    {
      field: 'description',
      title: '描述',
      // 变长文本列：表单允许 1024 字，宽度给足才不会被 tooltip 兜底
      minWidth: 240,
      align: 'left',
      showOverflow: 'tooltip',
    },
    {
      field: 'status',
      title: '状态',
      // ⚠️ 原子列（枚举）必须固定宽。写 minWidth: 90 时被撑到 **194px** ——
      // 一个两字 Tag 占掉 4 倍宽度，而真正需要宽度的「名称 / 描述」反而被压窄。
      width: 90,
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.COMMON_STATUS },
      },
    },
    {
      field: 'createTime',
      title: '创建时间',
      // 原子列：定长日期时间，固定宽（实测被撑到 274px）
      width: 170,
      formatter: 'formatDateTime',
    },
    {
      title: '操作',
      // 两个带图标的文字按钮（修改 / 删除）实测内容宽 139px，原值 140px 只剩 1px 余量，
      // 文案或图标微调就会贴边被裁。留出安全余量。
      width: 152,
      fixed: 'right',
      slots: { default: 'actions' },
    },
  ];
}
