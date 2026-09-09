// ── Vue Router ───────────────────────────────────────────

import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/log',
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { guest: true },
    },
    {
      path: '/log',
      name: 'log',
      component: () => import('@/views/LogView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/sql',
      name: 'sql',
      component: () => import('@/views/SqlView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/redis',
      name: 'redis',
      component: () => import('@/views/RedisView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/prd',
      name: 'prd',
      component: () => import('@/views/PrdView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/git',
      name: 'git',
      component: () => import('@/views/GitView.vue'),
      meta: { requiresAuth: true },
    },
  ],
})

router.beforeEach((to, _from, next) => {
  const auth = useAuthStore()
  const isAuth = auth.checkAuth()
  if (to.meta.requiresAuth && !isAuth) {
    next('/login?redirect=' + encodeURIComponent(to.fullPath))
  } else if (to.meta.guest && isAuth) {
    next('/log')
  } else {
    next()
  }
})

export default router
