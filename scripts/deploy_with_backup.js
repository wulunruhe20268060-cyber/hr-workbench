/**
 * 安全部署（HR 工作台）：备份 → 推送部署 → 校验 → 数据丢失自动恢复
 *
 * 用法：
 *   node scripts/deploy_with_backup.js ["commit message"]
 *   node scripts/deploy_with_backup.js --skip-push      # 只备份 + 校验（不推送）
 *   node scripts/deploy_with_backup.js --no-restore     # 校验但不自动恢复
 *   node scripts/deploy_with_backup.js --push-only      # 只推送（跳过备份，不推荐）
 *   node scripts/deploy_with_backup.js --baseline backups/hr-backup-xxx.json
 *        # 以指定备份归档为基准校验线上数据，若比基准少则用该归档恢复（可用于灾难恢复/事后核对）
 *
 * 环境变量（可选）：
 *   HR_BASE        默认 https://hr-workbench-wszg.onrender.com
 *   HR_ADMIN_USER / HR_ADMIN_PASS   默认 admin / admin123
 *   GH_PAT         GitHub token，默认内置
 *   HR_WAIT_SEC    等待新版本上线的上限秒数，默认 360
 *
 * 流程要点：
 *   1) 部署前先把线上全库导出到 backups/hr-backup-<时间戳>.json（这是硬性步骤，失败即中止，不推送）
 *   2) git 提交 + push_via_api.js 推送（触发 Render 重新部署）
 *   3) 轮询 /api/health，等新版本起来（版本号变化 或 uptime 归零）
 *   4) 对比部署前后的各集合条数；若出现数据丢失（某集合从有变无/变少）
 *      → 自动调用 /api/backup/import 覆盖恢复 → 再次校验 → 输出报告
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BASE = process.env.HR_BASE || 'https://hr-workbench-wszg.onrender.com';
const USER = process.env.HR_ADMIN_USER || 'admin';
const PASS = process.env.HR_ADMIN_PASS || 'admin123';
const WAIT_SEC = parseInt(process.env.HR_WAIT_SEC || '360', 10);

const ROOT = path.join(__dirname, '..');
// GitHub token 绝不写进代码（否则会被 GitHub secret scanning 拦下整次推送）。
// 读取顺序：环境变量 GH_PAT → 项目根目录 .gh_pat → backups/.gh_pat（均已在 .gitignore 中）
function readPat() {
  if (process.env.GH_PAT) return process.env.GH_PAT.trim();
  for (const p of [path.join(ROOT, '.gh_pat'), path.join(ROOT, 'backups', '.gh_pat')]) {
    if (fs.existsSync(p)) {
      const t = fs.readFileSync(p, 'utf8').trim();
      if (t) return t;
    }
  }
  return '';
}
const PAT = readPat();

const argv = process.argv.slice(2);
const SKIP_PUSH = argv.includes('--skip-push');
const PUSH_ONLY = argv.includes('--push-only');
const NO_RESTORE = argv.includes('--no-restore');
const BASELINE = (() => { const i = argv.indexOf('--baseline'); return i >= 0 ? argv[i + 1] : null; })();
const MSG = argv.filter(a => !a.startsWith('--') && a !== BASELINE).join(' ').trim();

const BACKUP_DIR = path.join(ROOT, 'backups');
const NODE = process.execPath;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function req(url, opt) {
  const r = await fetch(url, opt);
  const t = await r.text();
  let body = t;
  try { body = JSON.parse(t); } catch (e) {}
  return { status: r.status, body };
}

async function login() {
  const r = await req(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS })
  });
  if (r.status !== 200 || !r.body || !r.body.token) {
    throw new Error('登录失败(' + r.status + ')：' + JSON.stringify(r.body).slice(0, 160) + '\n如已改过管理员密码，请用 HR_ADMIN_USER/HR_ADMIN_PASS 环境变量传入。');
  }
  return r.body.token;
}

const AUTH = tk => ({ Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' });

function diffCounts(pre, post) {
  const lost = [], grown = {};
  Object.keys(pre || {}).forEach(k => {
    const a = pre[k] || 0, b = (post || {})[k] || 0;
    if (a > 0 && b < a) lost.push({ key: k, before: a, after: b, lost: a - b });
    else if (b > a) grown[k] = { before: a, after: b };
  });
  return { lost, grown };
}

// 线上是旧版本（无 /api/backup/*）时的兜底备份：逐集合抓取
const LEGACY_COLLECTIONS = ['interviews', 'hires', 'positions', 'progress', 'contracts', 'users', 'todos',
  'templates', 'board-history', 'candidates', 'jobSpecs', 'questionBanks', 'hiringDecisions', 'probations'];
const KEY_NORMALIZE = { 'board-history': 'boardHistory' };
async function legacyBackup(tk) {
  const dbOut = {}, counts = {};
  for (const c of LEGACY_COLLECTIONS) {
    const r = await req(BASE + '/api/' + c, { headers: AUTH(tk) });
    let v = [];
    if (r.status === 200 && Array.isArray(r.body)) v = r.body;
    else if (r.status === 200 && r.body && Array.isArray(r.body.items)) v = r.body.items;
    const key = KEY_NORMALIZE[c] || c;
    dbOut[key] = v; counts[key] = v.length;
    process.stdout.write('.' + c + '(' + v.length + ') ');
  }
  console.log('');
  return { _meta: { exportedAt: new Date().toISOString(), mode: 'legacy-逐集合', counts }, db: dbOut };
}

(async () => {
  const log = { base: BASE, startedAt: new Date().toISOString(), steps: [] };
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  console.log('=== HR 工作台安全部署 ===');
  console.log('目标：' + BASE);
  const tk = PUSH_ONLY ? null : await login();
  console.log('登录成功' + (PUSH_ONLY ? '（跳过）' : ''));

  // ---------- 1) 部署前备份 ----------
  let backupFile = null, backup = null;
  if (!PUSH_ONLY) {
    const info = await req(BASE + '/api/backup/info', { headers: AUTH(tk) });
    const hasBackupApi = info.status === 200 && info.body && typeof info.body === 'object' && info.body.counts;
    if (hasBackupApi) {
      console.log('\n[1/4] 线上当前状态：store=' + info.body.store + ' version=' + info.body.version);
      console.log('      线上条数：' + JSON.stringify(info.body.counts));
      if (info.body.store !== 'postgres') {
        console.log('      ⚠️  当前为【文件存储】：Render 重新部署会清空文件系统，务必备份/恢复！');
      }
    } else {
      console.log('\n[1/4] 线上为旧版本（无 /api/backup/info），改用逐集合兜底备份');
    }

    if (BASELINE) {
      // 以本地归档为基准（灾难恢复 / 事后核对）
      const p = path.resolve(ROOT, BASELINE);
      if (!fs.existsSync(p)) throw new Error('基准备份文件不存在：' + p);
      backup = JSON.parse(fs.readFileSync(p, 'utf8'));
      backupFile = p;
      const bCounts = (backup._meta && backup._meta.counts) || {};
      log.baseline = { file: p, counts: bCounts, exportedAt: (backup._meta && backup._meta.exportedAt) || '' };
      log.pre = { version: (info.body && info.body.version) || '', store: (info.body && info.body.store) || '', counts: bCounts, baseline: true };
      console.log('      基准归档：' + path.basename(p) + '（' + log.baseline.exportedAt + '）');
      console.log('      基准条数：' + JSON.stringify(bCounts));
    } else if (hasBackupApi) {
      log.pre = info.body;
      const ex = await req(BASE + '/api/backup/export', { headers: AUTH(tk) });
      if (ex.status !== 200) throw new Error('备份导出失败：' + ex.status + ' ' + JSON.stringify(ex.body).slice(0, 160));
      backup = ex.body;
      backupFile = path.join(BACKUP_DIR, 'hr-backup-' + stamp + '.json');
      fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), 'utf8');
      fs.writeFileSync(path.join(BACKUP_DIR, 'latest.json'), JSON.stringify({ file: backupFile, at: backup._meta.exportedAt, counts: backup._meta.counts }, null, 2), 'utf8');
      console.log('      备份已保存 → ' + backupFile + '（' + JSON.stringify(backup._meta.counts) + '）');
    } else {
      // 旧版本兜底：逐集合抓取，保证「部署前一定有一份完整本地备份」
      backup = await legacyBackup(tk);
      backupFile = path.join(BACKUP_DIR, 'hr-backup-legacy-' + stamp + '.json');
      fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), 'utf8');
      fs.writeFileSync(path.join(BACKUP_DIR, 'latest.json'), JSON.stringify({ file: backupFile, at: backup._meta.exportedAt, counts: backup._meta.counts }, null, 2), 'utf8');
      log.pre = { version: '', store: 'unknown(旧版本)', counts: backup._meta.counts, mode: 'legacy' };
      console.log('      兜底备份已保存 → ' + backupFile + '（' + JSON.stringify(backup._meta.counts) + '）');
    }
    log.backupFile = backupFile;
    if (!backup.db || !backup.db.interviews) throw new Error('备份内容异常（缺少 db.interviews），已中止，不执行推送。');
  }

  // ---------- 2) 推送部署 ----------
  if (!SKIP_PUSH) {
    console.log('\n[2/4] 提交并推送…');
    const cm = MSG || ('安全部署前备份 ' + stamp);
    const c1 = spawnSync('git', ['add', '-A'], { cwd: ROOT, encoding: 'utf8' });
    if (c1.status !== 0) console.log('      git add 警告：' + (c1.stderr || '').slice(0, 200));
    const c2 = spawnSync('git', ['-c', 'core.quotepath=false', 'commit', '-m', cm], { cwd: ROOT, encoding: 'utf8' });
    const commitOut = ((c2.stdout || '') + (c2.stderr || '')).trim();
    console.log('      ' + commitOut.split('\n').slice(0, 3).join(' | '));
    const c3 = spawnSync(NODE, [path.join(ROOT, 'push_via_api.js'), PAT], { cwd: ROOT, encoding: 'utf8' });
    const pushOut = ((c3.stdout || '') + (c3.stderr || '')).trim();
    const okPush = /PUSH_VIA_API_OK/.test(pushOut);
    console.log('      push ' + (okPush ? '成功' : '输出：' + pushOut.split('\n').slice(-3).join(' | ')));
    log.push = { ok: okPush, out: pushOut.split('\n').slice(-6) };
    if (!okPush) {
      console.log('\n推送失败 → 部署未发生，数据未受影响。备份文件：' + backupFile);
      process.exit(3);
    }
  } else {
    console.log('\n[2/4] 跳过推送（--skip-push）');
  }

  // ---------- 3) 等新版本上线 ----------
  if (!SKIP_PUSH) {
    console.log('\n[3/4] 等待新版本上线（最多 ' + WAIT_SEC + 's）…');
    const preVer = log.pre ? log.pre.version : '';
    const pushAt = Date.now();
    let up = false, last = null;
    const deadline = Date.now() + WAIT_SEC * 1000;
    while (Date.now() < deadline) {
      await sleep(8000);
      try {
        const h = await req(BASE + '/api/health');
        if (h.status !== 200) { last = 'health ' + h.status; continue; }
        last = h.body;
        const newVer = h.body.version && preVer && h.body.version !== preVer;
        const restarted = (h.body.uptime || 999) < 120 && (Date.now() - pushAt) > 45000;
        if (newVer || restarted) { up = true; console.log('      已上线：version=' + h.body.version + ' uptime=' + h.body.uptime + 's store=' + h.body.store); break; }
        console.log('      等待中… version=' + h.body.version + ' uptime=' + h.body.uptime + 's');
      } catch (e) { last = e.message; console.log('      探测失败：' + e.message); }
    }
    if (!up) {
      console.log('      ⚠️  未在限定时间内探测到新版本（可能仍在构建）。继续做数据校验。');
    }
    log.health = last;
  } else {
    console.log('\n[3/4] 跳过等待（--skip-push）');
  }

  // ---------- 4) 数据校验 + 自动恢复 ----------
  if (PUSH_ONLY) return;
  console.log('\n[4/4] 校验数据完整性…');
  const tk2 = await login();
  let post = await req(BASE + '/api/backup/info', { headers: AUTH(tk2) });
  if (post.status !== 200) throw new Error('部署后 /api/backup/info 失败：' + post.status);
  log.post = post.body;
  console.log('      条数：' + JSON.stringify(post.body.counts) + '（store=' + post.body.store + '）');

  let d = diffCounts(log.pre.counts, post.body.counts);
  if (!d.lost.length) {
    console.log('      ✅ 数据完整，无丢失。');
  } else {
    console.log('      ❌ 检测到数据丢失：' + JSON.stringify(d.lost));
    if (NO_RESTORE) {
      console.log('      （--no-restore）未自动恢复。请手动用「恢复数据」按钮导入：' + backupFile);
    } else {
      console.log('      正在自动恢复…');
      const im = await req(BASE + '/api/backup/import', { method: 'POST', headers: AUTH(tk2), body: JSON.stringify({ db: backup.db, mode: 'overwrite' }) });
      if (im.status !== 200) {
        console.log('      ❌ 自动恢复失败：' + im.status + ' ' + JSON.stringify(im.body).slice(0, 200));
      } else {
        console.log('      恢复返回：' + JSON.stringify(im.body.counts));
        // 覆盖恢复会把 users 一并替换（用户 id 可能变化），旧 token 会失效 → 重新登录再校验
        let tk3 = tk2;
        try { tk3 = await login(); } catch (e) { console.log('      ⚠️ 恢复后重新登录失败：' + e.message); }
        const after = await req(BASE + '/api/backup/info', { headers: AUTH(tk3) });
        if (after.status !== 200) {
          console.log('      ⚠️ 恢复后校验接口返回 ' + after.status + '（请人工确认线上数据）');
        } else {
          log.afterRestore = after.body;
          const d2 = diffCounts(log.pre.counts, after.body.counts);
          console.log('      恢复后条数：' + JSON.stringify(after.body.counts));
          console.log(d2.lost.length ? '      ⚠️ 恢复后仍有差异：' + JSON.stringify(d2.lost) : '      ✅ 恢复成功，数据已回到部署前状态。');
        }
      }
    }
  }
  if (Object.keys(d.grown).length) console.log('      备注：部分集合有新增 ' + JSON.stringify(d.grown));

  const logFile = path.join(BACKUP_DIR, 'deploy-log-' + stamp + '.json');
  log.finishedAt = new Date().toISOString();
  fs.writeFileSync(logFile, JSON.stringify(log, null, 2), 'utf8');
  console.log('\n部署日志 → ' + logFile);
  console.log(backupFile ? '本次备份 → ' + backupFile : '');
})().catch(e => { console.error('\n中止：' + e.message); process.exit(1); });
