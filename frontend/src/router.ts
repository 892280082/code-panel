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
  ],
})

export default router
