/**
 * 线上数据备份工具（部署前必备）
 * 用法：node scripts/backup_live.js [baseUrl] [username] [password]
 * 默认：https://hr-workbench-wszg.onrender.com  admin / admin123
 * 产物：backups/hr-backup-<时间戳>.json
 *
 * 优先调用 /api/backup/export（新版本提供，含全部集合）；
 * 老版本缺少该接口时，回退为逐个集合 GET 抓取。
 */
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'https://hr-workbench-wszg.onrender.com';
const USER = process.argv[3] || process.env.HR_ADMIN_USER || 'admin';
const PASS = process.argv[4] || process.env.HR_ADMIN_PASS || 'admin123';
const COLLECTIONS = ['interviews', 'hires', 'positions', 'progress', 'contracts', 'users', 'todos', 'templates', 'board-history', 'candidates', 'jobSpecs', 'questionBanks', 'hiringDecisions', 'probations'];

async function j(url, opt) {
  const r = await fetch(url, opt);
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch (e) { return { status: r.status, body: t }; }
}

(async () => {
  const login = await j(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS })
  });
  if (login.status !== 200 || !login.body.token) {
    console.error('登录失败：', login.status, JSON.stringify(login.body).slice(0, 200));
    process.exit(2);
  }
  const H = { Authorization: 'Bearer ' + login.body.token };
  const out = { _meta: { exportedAt: new Date().toISOString(), base: BASE, by: USER } };

  // 优先整体导出
  const full = await j(BASE + '/api/backup/export', { headers: H });
  if (full.status === 200 && full.body && full.body.db) {
    out._meta.mode = 'full';
    out._meta.counts = full.body.counts;
    out._meta.store = full.body.store;
    Object.assign(out, full.body.db);
    console.log('使用 /api/backup/export 整体导出');
  } else {
    out._meta.mode = 'per-collection';
    console.log('整体导出接口不可用（旧版本），改为逐集合抓取');
    for (const c of COLLECTIONS) {
      const r = await j(BASE + '/api/' + c, { headers: H });
      if (r.status !== 200) { console.log('  跳过', c, r.status); continue; }
      const v = Array.isArray(r.body) ? r.body : (r.body && (r.body.items || r.body.data)) || [];
      out[c] = v;
      console.log('  ' + c + ' = ' + v.length);
    }
  }

  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, 'hr-backup-' + stamp + '.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
  const counts = {};
  Object.keys(out).filter(k => k !== '_meta').forEach(k => { if (Array.isArray(out[k])) counts[k] = out[k].length; });
  console.log('\n备份完成 → ' + file);
  console.log('条数：' + JSON.stringify(counts));
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ file, at: out._meta.exportedAt, counts }), 'utf8');
})().catch(e => { console.error('备份异常：', e.message); process.exit(1); });
