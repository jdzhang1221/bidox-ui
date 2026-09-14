<script lang="ts" setup>
import type {
  WorkbenchProjectItem,
  WorkbenchQuickNavItem,
  WorkbenchTodoItem,
  WorkbenchTrendItem,
} from '@vben/common-ui';

import { ref } from 'vue';
import { useRouter } from 'vue-router';

import {
  AnalysisChartCard,
  WorkbenchHeader,
  WorkbenchProject,
  WorkbenchQuickNav,
  WorkbenchTodo,
  WorkbenchTrends,
} from '@vben/common-ui';
import { preferences } from '@vben/preferences';
import { useUserStore } from '@vben/stores';
import { openWindow } from '@vben/utils';

import AnalyticsVisitsSource from '../analytics/analytics-visits-source.vue';

const userStore = useUserStore();

// 这是一个示例数据，实际项目中需要根据实际情况进行调整
// url 也可以是内部路由，在 navTo 方法中识别处理，进行内部跳转
// 例如：url: /dashboard/workspace
const projectItems: WorkbenchProjectItem[] = [
  {
    color: '#6DB33F',
    content: 'github.com/jdzhang1221/bidox-service',
    date: '2026-09-13',
    group: 'Web 端管理后台服务',
    icon: 'simple-icons:springboot',
    title: 'bidox-service',
    url: 'https://github.com/jdzhang1221/bidox-service',
  },
  {
    color: '#409EFF',
    content: 'github.com/jdzhang1221/bidox-ui',
    date: '2026-09-13',
    group: '前端管理后台',
    icon: 'devicon:antdesign',
    title: 'bidox-ui',
    url: 'https://github.com/jdzhang1221/bidox-ui',
  },
  {
    color: '#ff4d4f',
    content: 'github.com/jdzhang1221/bidox',
    date: '2026-09-13',
    group: 'AI 服务：解析 / 向量化 / RAG / 生成',
    icon: 'logos:python',
    title: 'bidox-ai',
    url: 'https://github.com/jdzhang1221/bidox',
  },
];

// 同样，这里的 url 也可以使用以 http 开头的外部链接
const quickNavItems: WorkbenchQuickNavItem[] = [
  {
    color: '#1fdaca',
    icon: 'ion:home-outline',
    title: '首页',
    url: '/',
  },
  {
    color: '#3fb27f',
    icon: 'ion:people-outline',
    title: '用户管理',
    url: '/system/user',
  },
  {
    color: '#7c3aed',
    icon: 'ion:key-outline',
    title: '角色权限',
    url: '/system/role',
  },
  {
    color: '#1a73e8',
    icon: 'ion:list-outline',
    title: '菜单管理',
    url: '/system/menu',
  },
  {
    color: '#e18525',
    icon: 'ion:book-outline',
    title: '字典管理',
    url: '/system/dict',
  },
  {
    color: '#ff6b6b',
    icon: 'ion:timer-outline',
    title: '定时任务',
    url: '/infra/job',
  },
];

const todoItems = ref<WorkbenchTodoItem[]>([
  {
    completed: false,
    content: `解析招标文件，抽取项目信息与资格要求`,
    date: '2026-09-13 09:30:00',
    title: '招标文件理解',
  },
  {
    completed: false,
    content: `拆解评分办法，生成可逐条核对的评分点清单`,
    date: '2026-09-13 10:00:00',
    title: '评分点拆解',
  },
  {
    completed: false,
    content: `从企业知识库匹配资质、业绩与案例素材`,
    date: '2026-09-13 10:30:00',
    title: '企业知识匹配',
  },
  {
    completed: false,
    content: `按评分点生成标书章节，并支持证据溯源`,
    date: '2026-09-13 11:00:00',
    title: 'AI 标书生成',
  },
]);
const trendItems: WorkbenchTrendItem[] = [
  {
    avatar: 'svg:avatar-1',
    content: `在 <a>开源组</a> 创建了项目 <a>Vue</a>`,
    date: '刚刚',
    title: '威廉',
  },
  {
    avatar: 'svg:avatar-2',
    content: `关注了 <a>威廉</a> `,
    date: '1个小时前',
    title: '艾文',
  },
  {
    avatar: 'svg:avatar-3',
    content: `发布了 <a>个人动态</a> `,
    date: '1天前',
    title: '克里斯',
  },
  {
    avatar: 'svg:avatar-4',
    content: `发表文章 <a>如何编写一个Vite插件</a> `,
    date: '2天前',
    title: 'Vben',
  },
  {
    avatar: 'svg:avatar-1',
    content: `回复了 <a>杰克</a> 的问题 <a>如何进行项目优化？</a>`,
    date: '3天前',
    title: '皮特',
  },
  {
    avatar: 'svg:avatar-2',
    content: `关闭了问题 <a>如何运行项目</a> `,
    date: '1周前',
    title: '杰克',
  },
  {
    avatar: 'svg:avatar-3',
    content: `发布了 <a>个人动态</a> `,
    date: '1周前',
    title: '威廉',
  },
  {
    avatar: 'svg:avatar-4',
    content: `推送了代码到 <a>Github</a>`,
    date: '2021-04-01 20:00',
    title: '威廉',
  },
  {
    avatar: 'svg:avatar-4',
    content: `发表文章 <a>如何编写使用 Admin Vben</a> `,
    date: '2021-03-01 20:00',
    title: 'Vben',
  },
];

const router = useRouter();

// 这是一个示例方法，实际项目中需要根据实际情况进行调整
// This is a sample method, adjust according to the actual project requirements
function navTo(nav: WorkbenchProjectItem | WorkbenchQuickNavItem) {
  if (nav.url?.startsWith('http')) {
    openWindow(nav.url);
    return;
  }
  if (nav.url?.startsWith('/')) {
    router.push(nav.url).catch((error) => {
      console.error('Navigation failed:', error);
    });
  } else {
    console.warn(`Unknown URL for navigation item: ${nav.title} -> ${nav.url}`);
  }
}
</script>

<template>
  <div class="p-5">
    <WorkbenchHeader
      :avatar="userStore.userInfo?.avatar || preferences.app.defaultAvatar"
    >
      <template #title>
        早安, {{ userStore.userInfo?.nickname }}, 开始您一天的工作吧！
      </template>
      <template #description> 今日晴，20℃ - 32℃！ </template>
    </WorkbenchHeader>

    <div class="flex flex-col lg:flex-row">
      <div class="mr-4 w-full lg:w-3/5">
        <WorkbenchProject :items="projectItems" title="项目" @click="navTo" />
        <WorkbenchTrends :items="trendItems" class="mt-5" title="最新动态" />
      </div>
      <div class="w-full lg:w-2/5">
        <WorkbenchQuickNav
          :items="quickNavItems"
          class="lg:mt-0"
          title="快捷导航"
          @click="navTo"
        />
        <WorkbenchTodo :items="todoItems" class="mt-5" title="待办事项" />
        <AnalysisChartCard class="mt-5" title="访问来源">
          <AnalyticsVisitsSource />
        </AnalysisChartCard>
      </div>
    </div>
  </div>
</template>
