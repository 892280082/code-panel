// ── System resource monitor (CPU / Memory / Disk) ──
//   逐字移植自 code-server routes/resources.ts(含 GNU df -BM / ps aux --sort,
//   目标运行在 Linux)。macOS 分支(2026-09-09):内存走 vm_stat 真实口径
//   (os.freemem 把可回收缓存算已用,圆环虚高;活动监视器口径见 utils/memory-mac.ts),
//   磁盘/进程列表 BSD ps/df 选项适配 —— 返回结构与 Linux 完全同构。
import { Router } from 'express';
import os from 'os';
import { execSync } from 'child_process';
import { getMacMemory } from '../utils/memory-mac';
import { route } from '../utils/route-utils';

const router = Router();

// Cache last CPU measurement to compute delta-based percentage
let prevIdle = 0;
let prevTotal = 0;

function getCPUPercentage(): number {
  try {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      for (const type of Object.values(cpu.times)) {
        total += type;
      }
      idle += cpu.times.idle;
    }
    const diffIdle = idle - prevIdle;
    const diffTotal = total - prevTotal;
    prevIdle = idle;
    prevTotal = total;
    if (diffTotal === 0) return 0;
    return Math.round((1 - diffIdle / diffTotal) * 10000) / 100;
  } catch {
    const load = os.loadavg()[0];
    const cores = os.cpus().length;
    return Math.min(100, Math.round((load / cores) * 10000) / 100);
  }
}

function getDiskUsage(): { usedPercent: number; totalGB: string; usedGB: string; mount: string } {
  try {
    // Linux: df -BM(GNU);macOS: df -m(BSD,列位相同可直接复用解析)
    const cmd = process.platform === 'darwin' ? 'df -m / | tail -1' : 'df -BM / | tail -1';
    const raw = execSync(cmd, { encoding: 'utf8', timeout: 3000 }).trim();
    const parts = raw.split(/\s+/);
    const totalMB = parseInt(parts[1], 10);
    const usedMB = parseInt(parts[2], 10);
    const usedPercent = parseInt(parts[4], 10);
    const totalGB = (totalMB / 1024).toFixed(1);
    const usedGB = (usedMB / 1024).toFixed(1);
    // Linux 6 列(parts[5]=挂载点);macOS 9 列(parts[8]=挂载点,中间多 iused/ifree/%iused)
    const mount = process.platform === 'darwin' ? (parts[8] || '/') : parts[5];
    return { usedPercent, totalGB, usedGB, mount };
  } catch (err) {
    console.warn({ err }, 'Failed to read disk usage');
    return { usedPercent: 0, totalGB: '0.0', usedGB: '0.0', mount: '/' };
  }
}

router.get('/api/resources', route((_req, res) => {
  try {
    // macOS:vm_stat 真实口径(活动监视器同款);失败/其他平台回落 os 口径,结构同构
    const mac = process.platform === 'darwin' ? getMacMemory() : undefined;
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = mac ? mac.percent : Math.round((usedMem / totalMem) * 10000) / 100;
    const memUsedGB = mac ? mac.usedGB : (usedMem / 1024 / 1024 / 1024).toFixed(1);
    const memTotalGB = mac ? mac.totalGB : (totalMem / 1024 / 1024 / 1024).toFixed(1);

    const cpuPercent = getCPUPercentage();
    const loadAvg = os.loadavg();
    const cpuCores = os.cpus().length;

    const disk = getDiskUsage();

    res.json({
      cpu: {
        percent: cpuPercent,
        cores: cpuCores,
        load1: Math.round(loadAvg[0] * 100) / 100,
        load5: Math.round(loadAvg[1] * 100) / 100,
      },
      memory: {
        percent: memPercent,
        usedGB: memUsedGB,
        totalGB: memTotalGB,
      },
      disk: {
        percent: disk.usedPercent,
        usedGB: disk.usedGB,
        totalGB: disk.totalGB,
        mount: disk.mount,
      },
    });
  } catch (err) {
    console.error({ err }, 'Failed to get system resources');
    res.status(500).json({ error: 'Failed to read system resources' });
  }
}));

// ── Process list top by memory ──
router.get('/api/resources/processes', route((_req, res) => {
  try {
    // Linux: ps aux --sort=-%mem(GNU);macOS: ps -axm 按内存排序,列序 PID %CPU %MEM RSS COMM
    const isMac = process.platform === 'darwin';
    const cmd = isMac ? 'ps -axm -o pid,pcpu,pmem,rss,comm | head -31' : 'ps aux --sort=-%mem | head -31';
    const raw = execSync(cmd, { encoding: 'utf8', timeout: 5000 });
    const lines = raw.trim().split('\n');
    // Skip header line, parse remaining
    const processes = lines.slice(1).map(line => {
      const parts = line.trim().split(/\s+/);
      if (isMac) {
        // PID %CPU %MEM RSS COMMAND(命令名可能在最后,含空格)
        const pid = parseInt(parts[0], 10) || 0;
        const cpuPercent = parseFloat(parts[1]) || 0;
        const memPercent = parseFloat(parts[2]) || 0;
        const rssKB = parseInt(parts[3], 10) || 0;
        const rssMB = Math.round(rssKB / 1024 * 10) / 10;
        const name = parts.slice(4).join(' ') || '?';
        return { pid, name, memPercent: Math.round(memPercent * 10) / 10, rssMB, cpuPercent: Math.round(cpuPercent * 10) / 10 };
      }
      // USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
      const pid = parseInt(parts[1], 10) || 0;
      const cpuPercent = parseFloat(parts[2]) || 0;
      const memPercent = parseFloat(parts[3]) || 0;
      const rssKB = parseInt(parts[5], 10) || 0;
      const rssMB = Math.round(rssKB / 1024 * 10) / 10;
      const name = parts.slice(10).join(' ') || parts[0];
      return { pid, name, memPercent: Math.round(memPercent * 10) / 10, rssMB, cpuPercent: Math.round(cpuPercent * 10) / 10 };
    }).filter(p => p.pid > 0);
    res.json({ processes });
  } catch (err) {
    console.warn({ err }, 'Failed to read process list');
    res.status(500).json({ error: 'Failed to read process list' });
  }
}));

export default router;
