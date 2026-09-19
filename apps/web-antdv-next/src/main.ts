import { initPreferences } from '@vben/preferences';
import { unmountGlobalLoading } from '@vben/utils';

import { overridesPreferences } from './preferences';

/**
 * 偏好设置缓存版本号。
 *
 * ⚠️ **每次修改 `preferences.ts` 里的默认值后，把这里 +1。**
 *
 * 为什么需要它：`@vben-core/preferences` 的 `initPreferences` 是这样合并的
 * （packages/@core/preferences/src/preferences.ts:138-151）：
 *
 * ```js
 * mergeWithArrayOverride({}, cachedPreferences, initialPreferences)
 * //                       ↑ localStorage 旧快照优先，代码默认值只补缺失字段
 * ```
 *
 * 也就是说**缓存压过代码**，而且初始化结束时会立刻把合并结果写回缓存
 * （`await this.saveToCache()`）—— 于是「改 `preferences.ts` 不生效」会反复出现，
 * 每个访问过的浏览器（甚至 `localhost` 与 `127.0.0.1` 两个源各算一个）都要手动清缓存。
 * 这个版本号就是自动清缓存的门闩：版本一变，旧快照全部作废。
 *
 * 只清偏好设置相关的 4 个 key，**不碰登录态 / 用户信息**（那些是别的 namespace key）。
 */
const PREFERENCES_CACHE_VERSION = 2;

/** 与 `@vben-core/preferences` 的 `STORAGE_KEYS` 一一对应，实际键名是 `${namespace}-${key}` */
const PREFERENCES_CACHE_KEYS = [
  'preferences',
  'preferences-custom',
  'preferences-locale',
  'preferences-theme',
] as const;

function migratePreferencesCache(namespace: string) {
  const versionKey = `${namespace}-preferences-cache-version`;
  if (localStorage.getItem(versionKey) === String(PREFERENCES_CACHE_VERSION)) {
    return;
  }
  for (const key of PREFERENCES_CACHE_KEYS) {
    localStorage.removeItem(`${namespace}-${key}`);
  }
  localStorage.setItem(versionKey, String(PREFERENCES_CACHE_VERSION));
}

/**
 * 应用初始化完成之后再进行页面加载渲染
 */
async function initApplication() {
  // name用于指定项目唯一标识
  // 用于区分不同项目的偏好设置以及存储数据的key前缀以及其他一些需要隔离的数据
  const env = import.meta.env.PROD ? 'prod' : 'dev';
  const appVersion = import.meta.env.VITE_APP_VERSION;
  const namespace = `${import.meta.env.VITE_APP_NAMESPACE}-${appVersion}-${env}`;

  // 必须在 initPreferences 之前：先作废旧快照，新默认值才生效
  migratePreferencesCache(namespace);

  // app偏好设置初始化
  await initPreferences({
    // extension: preferencesExtension,
    namespace,
    overrides: overridesPreferences,
  });

  // 启动应用并挂载
  // vue应用主要逻辑及视图
  const { bootstrap } = await import('./bootstrap');
  await bootstrap(namespace);

  // 移除并销毁loading
  unmountGlobalLoading();
}

initApplication();
