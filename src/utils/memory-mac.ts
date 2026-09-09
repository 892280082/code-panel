// ── macOS Apple Silicon 真实内存口径 ──
//   os.freemem() 在 macOS 只统计「完全空闲页」,把可回收的文件缓存/inactive 页全算成已用,
//   圆环会虚高(实测 24G 机器显示 81%,活动监视器同口径 ~57%)。
//   用 vm_stat 按活动监视器口径重算:used = App内存 + 已联线 + 压缩器占据。
//   命令均免 sudo、~2ms;任一步失败返回 undefined,调用方回落 os 口径。

import { execSync } from 'child_process';
import os from 'os';

export interface MemoryReading {
  percent: number;
  usedGB: string;
  totalGB: string;
}

export function getMacMemory(): MemoryReading | undefined {
  try {
    const vm = execSync('vm_stat', { encoding: 'utf8', timeout: 3000 });
    // 页大小从输出首行取(Apple Silicon = 16384),勿硬编码
    const pageSize = parseInt(vm.match(/page size of (\d+)/)?.[1] || '16384', 10);
    // vm_stat 数值行尾带句点("Pages free: 291149."),/^...(\d+)/ 提取后 parseInt 自动截断
    const pages = (label: string): number => {
      const m = vm.match(new RegExp(`^${label}:\\s+(\\d+)`, 'm'));
      return m ? parseInt(m[1], 10) : 0;
    };
    const anonymous = pages('Anonymous pages');
    const purgeable = pages('Pages purgeable');
    const wired = pages('Pages wired down');
    const compressed = pages('Pages occupied by compressor');

    const total = os.totalmem();
    const appMemory = anonymous - purgeable;                 // 活动监视器「App 内存」口径
    const usedBytes = (appMemory + wired + compressed) * pageSize;
    return {
      percent: Math.round((usedBytes / total) * 10000) / 100,
      usedGB: (usedBytes / 1024 ** 3).toFixed(1),
      totalGB: (total / 1024 ** 3).toFixed(1),
    };
  } catch {
    return undefined;
  }
}
