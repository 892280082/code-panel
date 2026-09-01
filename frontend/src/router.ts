// ── Vue Router ───────────────────────────────────────────

import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/log',
    },
    {
      path: '/log',
      name: 'log',
      component: () => import('@/views/LogView.vue'),
    },
    {
      path: '/sql',
      name: 'sql',
      component: () => import('@/views/SqlView.vue'),
    },
    {
      path: '/prd',
      name: 'prd',
      component: () => import('@/views/PrdView.vue'),
    },
    {
      path: '/git',
      name: 'git',
      component: () => import('@/views/GitView.vue'),
    },
  ],
})

export default router
