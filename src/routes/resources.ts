// ── System resource monitor (CPU / Memory / Disk) ──
//   逐字移植自 code-server routes/resources.ts(含 GNU df -BM / ps aux --sort,
//   目标运行在 Linux;本机 macOS 因 ps/df 差异读数不准属预期)。
//   唯一与上游差异:上游用 pino logger,本仓库没有 → 落 console,与读数逻辑无关。
import { Router } from 'express';
import os from 'os';
import { execSync } from 'child_process';

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
    const raw = execSync("df -BM / | tail -1", { encoding: 'utf8', timeout: 3000 }).trim();
    const parts = raw.split(/\s+/);
    const totalMB = parseInt(parts[1], 10);
    const usedMB = parseInt(parts[2], 10);
    const usedPercent = parseInt(parts[4], 10);
    const totalGB = (totalMB / 1024).toFixed(1);
    const usedGB = (usedMB / 1024).toFixed(1);
    return { usedPercent, totalGB, usedGB, mount: parts[5] };
  } catch (err) {
    console.warn({ err }, 'Failed to read disk usage');
    return { usedPercent: 0, totalGB: '0.0', usedGB: '0.0', mount: '/' };
  }
}

router.get('/api/resources', (_req, res) => {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = Math.round((usedMem / totalMem) * 10000) / 100;
    const memUsedGB = (usedMem / 1024 / 1024 / 1024).toFixed(1);
    const memTotalGB = (totalMem / 1024 / 1024 / 1024).toFixed(1);

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
});

// ── Process list top by memory ──
router.get('/api/resources/processes', (_req, res) => {
  try {
    const raw = execSync('ps aux --sort=-%mem | head -31', { encoding: 'utf8', timeout: 5000 });
    const lines = raw.trim().split('\n');
    // Skip header line, parse remaining
    const processes = lines.slice(1).map(line => {
      const parts = line.trim().split(/\s+/);
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
});

export default router;
