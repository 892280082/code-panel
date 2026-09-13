<script setup lang="ts">
// ── GLM Plan 顶栏迷你仪表盘(两个小矩形:5h / 周)+ 悬停大弹窗 ────
//   位置:TopRightTools 里 SystemResourceMonitor(CPU/内存圆环)右边。
//   显隐:⚙ → 模型 →「Plan 额度」两个开关全开才显示;点击 = 手动刷新。
//   悬停小矩形 → 下方弹大详情窗(供应商/套餐 + 两条大进度条),移开即收。
import { computed } from 'vue'
import { useGlmPlanStore, countdown, usageColor } from '@/stores/glm-plan'

const glm = useGlmPlanStore()
glm.init()   // 幂等:开关恢复 + 已开启则起轮询(仪表盘藏在 v-if 里也要先 init)

const gauges = computed(() =>
  (glm.quota?.pools ?? []).map(p => ({
    key: p.key,
    tag: p.key === '5h' ? '5h' : p.key === 'week' ? '周' : p.key,
    percent: Math.round(p.percent),
    color: usageColor(p.percent),
  })),
)

/** fetchedAt → HH:MM:SS(弹窗脚注"更新于") */
function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
</script>

<template>
  <span v-if="glm.enabled && glm.topbar" class="gpg-wrap" title="GLM Coding Plan 额度(点击刷新)">
    <!-- 迷你矩形(常驻) -->
    <span class="gpg-inline">
      <span v-if="!gauges.length && !glm.err" class="gpg-loading">···</span>
      <span v-else-if="!gauges.length && glm.err" class="gpg-err" :title="glm.err">⚠</span>
      <span v-for="g in gauges" :key="g.key" class="gpg-box">
        <span class="gpg-tag">{{ g.tag }}</span>
        <span class="gpg-pct" :style="{ color: g.color }">{{ g.percent }}</span>
        <span class="gpg-bar"><span class="gpg-fill" :style="{ width: g.percent + '%', background: g.color }" /></span>
      </span>
    </span>

    <!-- 悬停大弹窗:详情都在这,平时完全隐藏 -->
    <span v-if="glm.quota" class="gpg-pop">
      <div class="gpg-pop-head">
        <span class="gpg-pop-name">{{ glm.quota.providerName }}</span>
        <span class="gpg-pop-level">{{ glm.quota.level || '—' }}</span>
      </div>
      <div v-for="p in glm.quota.pools" :key="p.key" class="gpg-pop-row">
        <div class="gpg-pop-line">
          <span class="gpg-pop-pool">{{ p.label }}池</span>
          <span class="gpg-pop-pct" :style="{ color: usageColor(p.percent) }">{{ Math.round(p.percent) }}%</span>
          <span class="gpg-pop-reset">{{ countdown(p.resetAt) }}</span>
        </div>
        <div class="gpg-pop-bar"><span class="gpg-pop-fill" :style="{ width: p.percent + '%', background: usageColor(p.percent) }" /></div>
        <div class="gpg-pop-detail">剩余 {{ p.remaining.toLocaleString() }} / {{ p.total.toLocaleString() }} 点</div>
      </div>
      <div class="gpg-pop-foot">点击刷新 · 更新于 {{ fmtTime(glm.quota.fetchedAt) }}</div>
    </span>
  </span>
</template>

<style scoped>
/* 悬停容器:常驻迷你矩形 + 隐藏弹窗;hover 在容器上,移进弹窗也不消失 */
.gpg-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
  opacity: 0.8;
  transition: opacity 0.15s;
}
.gpg-wrap:hover { opacity: 1; }

/* ── 迷你矩形(对齐 SystemResourceMonitor 的 inline 触发器形态)── */
.gpg-inline { display: inline-flex; align-items: center; gap: 3px; }
.gpg-box {
  position: relative;
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  width: 42px; height: 20px;
  padding: 1px 4px 3px;
  box-sizing: border-box;
  background: var(--bg, #16161a);
  border: 1px solid var(--border, #2c2c33);
  border-radius: 4px;
  overflow: hidden;
  font-family: 'Fira Code', monospace;
}
.gpg-tag { font-size: 8px; color: var(--text-dim, #888); }
.gpg-pct { font-size: 10px; font-weight: 700; margin-left: auto; }
.gpg-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: rgba(255,255,255,0.08); }
.gpg-fill { display: block; height: 100%; transition: width 0.8s ease, background 0.4s ease; }
.gpg-loading { font-size: 9px; color: var(--text-dim); animation: gpg-pulse 1.5s ease-in-out infinite; }
@keyframes gpg-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
.gpg-err { font-size: 11px; color: var(--danger, #f44747); }

/* ── 悬停大弹窗 ── */
.gpg-pop {
  display: none;
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 236px;
  padding: 10px 12px 8px;
  box-sizing: border-box;
  background: var(--surface, #1d1d23);
  border: 1px solid var(--border, #2c2c33);
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
  z-index: 60;
}
.gpg-wrap:hover .gpg-pop { display: block; }

.gpg-pop-head {
  display: flex; align-items: center; gap: 6px;
  padding-bottom: 7px; margin-bottom: 8px;
  border-bottom: 1px solid var(--border, #2c2c33);
}
.gpg-pop-name { font-size: 12px; font-weight: 700; color: var(--text, #e6e6ea); }
.gpg-pop-level {
  margin-left: auto;
  font-size: 9px; font-weight: 600; letter-spacing: 0.04em;
  color: var(--glow, #22ee66);
  border: 1px solid var(--glow-dim, rgba(34,238,102,0.35));
  border-radius: 8px; padding: 1px 7px;
  text-transform: uppercase;
}

.gpg-pop-row { display: flex; flex-direction: column; gap: 3px; padding: 4px 0 7px; }
.gpg-pop-line { display: flex; align-items: baseline; gap: 6px; }
.gpg-pop-pool { font-size: 12px; font-weight: 600; color: var(--text, #e6e6ea); }
.gpg-pop-pct { font-size: 14px; font-weight: 700; font-family: 'Fira Code', monospace; }
.gpg-pop-reset { margin-left: auto; font-size: 9px; color: var(--text-dim, #888); }
.gpg-pop-bar { height: 10px; border-radius: 5px; background: rgba(255,255,255,0.07); overflow: hidden; }
.gpg-pop-fill { display: block; height: 100%; border-radius: 5px; transition: width 0.8s ease, background 0.4s ease; }
.gpg-pop-detail { font-size: 9px; color: var(--text-dim, #888); font-family: 'Fira Code', monospace; }

.gpg-pop-foot {
  padding-top: 6px; margin-top: 2px;
  border-top: 1px solid var(--border, #2c2c33);
  font-size: 9px; color: var(--text-dim, #888);
}
</style>
