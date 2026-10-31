// ── FRP 公网开关路由(⚙ →「安全」Tab 首卡 + 🔗 快捷方式)────────
//   实现:调用外部 frp-public.sh 脚本(frpc includes + reload 热切换)
//   GET  /api/security/frp          → 状态(登录即可看)
//   GET  /api/security/frp/:action  → on/off 切换(仅超管;GET 形式供快捷方式链接点开,
//                                     ?text=1 时回纯文本,浏览器新标签直接显示结果)

import os from 'os';
import path from 'path';
import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';
import { route, errorMessage } from '../utils/route-utils';
import { requireSuperadmin } from '../auth/jwt';

export const frpRouter = Router();

// 开关脚本路径可用 CODE_PANEL_FRP_SCRIPT 覆盖;默认放在全局数据目录
const FRP_SCRIPT = process.env.CODE_PANEL_FRP_SCRIPT
  || path.join(os.homedir(), '.code-panel', 'frp-public.sh');

// 公网口 → 服务明细(与脚本 public.ini 保持一致)
const PORT_TABLE = [
  { port: 60101, service: '共享入口(nginx:80,按 Host 分流多平台)' },
  { port: 60111, service: '平台 A(nginx:8801)' },
  { port: 60112, service: '平台 B(nginx:8802)' },
  { port: 60113, service: '平台 C(nginx:8803)' },
];

function runScript(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('bash', [FRP_SCRIPT, ...args], { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim()));
      else resolve(String(stdout).trim());
    });
  });
}

async function frpStatus(): Promise<{ on: boolean; reachable: boolean; raw: string; ports: typeof PORT_TABLE }> {
  try {
    const raw = await runScript(['status']);
    return { on: raw.includes('开关状态: ON'), reachable: true, raw, ports: PORT_TABLE };
  } catch (e) {
    return { on: false, reachable: false, raw: `frpc admin 不可达:${errorMessage(e)}`, ports: PORT_TABLE };
  }
}

frpRouter.get('/api/security/frp', route((_req: Request, res: Response) => {
  frpStatus().then((data) => res.json({ ok: true, data }));
}));

frpRouter.get('/api/security/frp/:action', requireSuperadmin, route((req: Request, res: Response) => {
  const action = req.params.action;
  if (action !== 'on' && action !== 'off') {
    res.status(400).json({ ok: false, error: 'action 仅支持 on / off' });
    return;
  }
  runScript([action])
    .then(async (raw) => {
      if (req.query.text) {
        res.type('text/plain; charset=utf-8').send(`${raw}\n\n(3 秒后可关闭此页;状态见 ⚙ → 安全)`);
        return;
      }
      const data = await frpStatus();
      res.json({ ok: true, data: { ...data, raw } });
    })
    .catch((e) => res.status(500).json({ ok: false, error: errorMessage(e) }));
}));
