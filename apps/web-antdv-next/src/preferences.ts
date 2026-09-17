import { defineOverridesPreferences } from '@vben/preferences';

/**
 * @description 项目配置文件
 * 只需要覆盖项目中的一部分配置，不需要的配置不用覆盖，会自动使用默认配置
 * !!! 更改配置后请清空缓存，否则可能不生效
 */
export const overridesPreferences = defineOverridesPreferences({
  // overrides
  app: {
    /** 后端路由模式 */
    accessMode: 'backend',
    name: import.meta.env.VITE_APP_TITLE,
    enableRefreshToken: true,
    /**
     * 关闭偏好设置按钮：enablePreferences 为 false 时，
     * preferencesButtonPosition 的 header / fixed / userDropdown 全为 false，
     * 因此右上角的设置齿轮和头像下拉里的「偏好设置」会一并消失
     */
    enablePreferences: false,
  },
  /**
   * 头部右侧 widget 显隐与位置。
   *
   * 渲染条件见 packages/effects/layouts/src/basic/header/header.vue：
   *   widget.x && widget.xButtonPosition === 'header'
   * 所以「置 false」= 彻底不显示（头部和下拉里都没有）。
   *
   * 本次产品要求：右上角只保留「租户切换 + 通知 + 头像」，
   * 并且把「退出」从右上角移入头像下拉。
   */
  widget: {
    /** 退出按钮移入头像下拉（默认 'header' 是右上角独立图标） */
    logoutButtonPosition: 'user-dropdown',
    /** 以下全部隐藏 */
    globalSearch: false,
    themeToggle: false,
    languageToggle: false,
    timezone: false,
    fullscreen: false,
    refresh: false,
    lockScreen: false,
    /** 通知保留在右上角 */
    notification: true,
    notificationButtonPosition: 'header',
  },
  footer: {
    /** 默认关闭 footer 页脚，因为有一定遮挡 */
    enable: false,
    fixed: false,
  },
  copyright: {
    companyName: import.meta.env.VITE_APP_TITLE,
    companySiteLink: 'https://github.com/jdzhang1221/bidox-ui',
  },
  // copyright: appCopyrightPreferences,
});

// export const preferencesExtension =
//   definePreferencesExtension<WebAntdPreferencesExtension>({
//     tabLabel: 'preferences.antd.tabLabel',
//     title: 'preferences.antd.title',
//     fields: [
//       {
//         component: 'switch',
//         defaultValue: true,
//         key: 'enableFormFullscreen',
//         label: 'preferences.antd.fields.enableFormFullscreen.label',
//         tip: 'preferences.antd.fields.enableFormFullscreen.tip',
//       },
//       {
//         component: 'select',
//         defaultValue: 'single',
//         key: 'tenantMode',
//         label: 'preferences.antd.fields.tenantMode.label',
//         options: [
//           {
//             label: 'preferences.antd.fields.tenantMode.options.single.label',
//             value: 'single',
//           },
//           {
//             label: 'preferences.antd.fields.tenantMode.options.multi.label',
//             value: 'multi',
//           },
//         ],
//       },
//       {
//         component: 'number',
//         componentProps: {
//           max: 200,
//           min: 10,
//           step: 10,
//         },
//         defaultValue: 20,
//         key: 'defaultTableSize',
//         label: 'preferences.antd.fields.defaultTableSize.label',
//       },
//       {
//         component: 'input',
//         defaultValue: '',
//         key: 'reportTitle',
//         label: 'preferences.antd.fields.reportTitle.label',
//         placeholder: 'preferences.antd.fields.reportTitle.placeholder',
//       },
//     ],
//   });
