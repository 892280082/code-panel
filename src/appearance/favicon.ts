// ── 装修:favicon 预设 + SVG 渲染(⚙ 配置 →「装修」Tab)──
//   同一款 </> 终端造型换 8 种颜色;多台电脑各设一色,浏览器标签一眼区分。
//   模板与 frontend/public/favicon.svg 保持同构(默认绿走静态文件,其余色动态渲染)。

export interface FaviconPreset {
  id: string;
  label: string;
  color: string;
}

export const FAVICON_PRESETS: FaviconPreset[] = [
  { id: 'green',  label: '绿(默认)', color: '#22ee66' },
  { id: 'cyan',   label: '青',       color: '#22d3ee' },
  { id: 'blue',   label: '蓝',       color: '#4a9eff' },
  { id: 'purple', label: '紫',       color: '#a78bfa' },
  { id: 'pink',   label: '粉',       color: '#f472b6' },
  { id: 'red',    label: '红',       color: '#f44747' },
  { id: 'orange', label: '橙',       color: '#f0a030' },
  { id: 'yellow', label: '黄',       color: '#facc15' },
];

export function findFaviconPreset(id: string): FaviconPreset | undefined {
  return FAVICON_PRESETS.find((p) => p.id === id);
}

/** 按预设色渲染 favicon SVG(结构同 frontend/public/favicon.svg,只换背景色)
 *   配色策略:整块彩色背景 + 白色 '</>' —— 图标缩到标签尺寸后色块依旧一眼可辨。 */
export function renderFaviconSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="55%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <!-- Rounded color background -->
  <rect x="2" y="2" width="60" height="60" rx="12" ry="12" fill="${color}"/>
  <rect x="2" y="2" width="60" height="60" rx="12" ry="12" fill="url(#gloss)"/>
  <!-- Top bar dots (white with decreasing opacity to avoid color clashes with the background) -->
  <circle cx="12" cy="12" r="1.6" fill="#ffffff" opacity="0.9"/>
  <circle cx="18" cy="12" r="1.6" fill="#ffffff" opacity="0.6"/>
  <circle cx="24" cy="12" r="1.6" fill="#ffffff" opacity="0.35"/>
  <!-- Prompt + code brackets '</>' (注意:模板字符串内不能出现反引号) -->
  <text x="32" y="42" font-family="ui-monospace, 'Fira Code', Menlo, monospace" font-size="22" font-weight="700" text-anchor="middle" fill="#ffffff">&lt;/&gt;</text>
  <!-- Subtle underscore cursor -->
  <rect x="44" y="34" width="6" height="2" fill="#ffffff" opacity="0.85"/>
</svg>`;
}
