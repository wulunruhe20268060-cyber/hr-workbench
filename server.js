const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 80;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const ADMIN_USERNAME = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASS || 'admin123';

// ========== Middleware ==========
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.disable('etag');

// ========== Database ==========
let db = { users: [], positions: [], interviews: [], todos: [], templates: [], hires: [], progress: [], contracts: [] };
let tokens = {};

// ---- Postgres (optional): used when DATABASE_URL is set, else falls back to JSON file ----
// On Koyeb free tier, attach the free Postgres database and set DATABASE_URL to persist data
// across redeploys. Any Postgres error automatically degrades to the file store (no crash).
let pgClient = null;
let usePg = false;

function loadDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
  } catch (e) { console.error('DB load error:', e.message); }
}

// Load db from Postgres (if DATABASE_URL) or local file (fallback)
async function initStore() {
  if (process.env.DATABASE_URL) {
    try {
      const pg = require('pg');
      pgClient = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
      await pgClient.connect();
      await pgClient.query('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)');
      const r = await pgClient.query("SELECT value FROM kv WHERE key='db'");
      if (r.rows.length > 0) {
        db = JSON.parse(r.rows[0].value);
        console.log('DB loaded from Postgres');
      } else {
        console.log('No DB row in Postgres, will seed on first save');
      }
      usePg = true;
      return;
    } catch (e) {
      console.error('Postgres init failed, falling back to file store:', e.message);
      usePg = false;
    }
  }
  loadDb();
}

// Save db -> Postgres (if active) or local file (fallback). Fire-and-forget safe.
async function saveDb() {
  try {
    if (usePg && pgClient) {
      await pgClient.query(
        "INSERT INTO kv(key,value) VALUES('db',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
        [JSON.stringify(db)]
      );
      return;
    }
  } catch (e) {
    console.error('PG save error:', e.message);
  }
  // file fallback
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_PATH + '.tmp', JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(DB_PATH + '.tmp', DB_PATH);
  } catch (e) { console.error('DB save error:', e.message); }
}

function hashPass(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

function genSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

function genId() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
}

// ========== Seed Data ==========
function seedDb() {
  if (db.users.length > 0) return;
  const now = new Date().toISOString().split('T')[0];
  const adminSalt = genSalt();
  const adminId = genId();

  // Admin user
  db.users.push({
    id: adminId, username: ADMIN_USERNAME, role: 'admin',
    salt: adminSalt, password: hashPass(ADMIN_PASSWORD, adminSalt),
    displayName: '管理员'
  });

  // Member user for demo
  const m1Salt = genSalt();
  const m1Id = genId();
  db.users.push({
    id: m1Id, username: 'zhangwei', role: 'member',
    salt: m1Salt, password: hashPass('123456', m1Salt),
    displayName: '张伟'
  });

  // Templates
  const tpl1Id = genId();
  const tpl2Id = genId();
  db.templates = [
    { id: tpl1Id, name: '入职1周访谈', questions: ['对新环境的适应情况如何？', '团队融入感觉怎么样？', '工作内容和入职预期有差距吗？', '有没有遇到什么困难需要帮助？'], createdBy: adminId, createdAt: now },
    { id: tpl2Id, name: '入职1个月访谈', questions: ['目前工作上手程度如何？', '和直属上级沟通顺畅吗？', '公司文化适应得怎么样？', '对培训/带教有什么建议？', '近期的职业发展期望是什么？'], createdBy: adminId, createdAt: now }
  ];

  // Positions
  const d = new Date();
  d.setDate(d.getDate() + 7);
  const fut7 = d.toISOString().split('T')[0];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const ys = yesterday.toISOString().split('T')[0];

  db.positions = [
    { id: genId(), position: '高级前端工程师', dept: '技术部', headcount: 2, deadline: fut7,
      stages: { resumeScreen: 12, firstInterview: 5, secondInterview: 3, finalInterview: 1, offer: 0, onboard: 0 },
      status: 'active', createdBy: adminId, createdAt: ys },
    { id: genId(), position: 'HRBP', dept: '人力资源部', headcount: 1, deadline: fut7,
      stages: { resumeScreen: 8, firstInterview: 4, secondInterview: 2, finalInterview: 1, offer: 1, onboard: 0 },
      status: 'active', createdBy: adminId, createdAt: ys },
    { id: genId(), position: '市场运营经理', dept: '市场部', headcount: 1, deadline: ys,
      stages: { resumeScreen: 15, firstInterview: 6, secondInterview: 3, finalInterview: 2, offer: 0, onboard: 0 },
      status: 'active', createdBy: adminId, createdAt: '2026-07-15' }
  ];

  // Interviews
  db.interviews = [
    { id: genId(), name: '李明', position: '高级前端工程师', phone: '13812345678',
      education: '本科', gender: '男', inviter: '张主管', source: 'BOSS直聘',
      firstInterviewDate: now, secondInterviewDate: '', interviewer: '张主管',
      result: '待面试', expectedOnboardDate: '', notes: '5年React经验，有大厂背景',
      createdBy: m1Id, createdAt: ys },
    { id: genId(), name: '王芳', position: 'HRBP', phone: '13987654321',
      education: '硕士', gender: '女', inviter: '李总监', source: '猎头推荐',
      firstInterviewDate: ys, secondInterviewDate: '', interviewer: '李总监',
      result: '通过', expectedOnboardDate: '2026-08-15', notes: '沟通能力强，6年HR经验',
      createdBy: m1Id, createdAt: '2026-07-28' },
    { id: genId(), name: '张伟面试', position: '市场运营经理', phone: '13611112222',
      education: '本科', gender: '男', inviter: '王总', source: '内推',
      firstInterviewDate: '2026-07-20', secondInterviewDate: '2026-07-25', interviewer: '王总',
      result: '待定', expectedOnboardDate: '', notes: '需确认薪资期望',
      createdBy: adminId, createdAt: '2026-07-18' },
    { id: genId(), name: '赵雪', position: '高级前端工程师', phone: '13733334444',
      education: '大专', gender: '女', inviter: '张主管', source: '拉勾',
      firstInterviewDate: ys, secondInterviewDate: '', interviewer: '张主管',
      result: '淘汰', expectedOnboardDate: '', notes: '技术基础偏弱',
      createdBy: m1Id, createdAt: ys }
  ];

  // Todos
  db.todos = [
    { id: genId(), title: '确认王芳的Offer薪资方案', frequency: '日', priority: 'P0', dueDate: ys, completed: false, createdBy: adminId, createdAt: ys },
    { id: genId(), title: '整理本周面试通过人员汇总', frequency: '周', priority: 'P1', dueDate: now, completed: false, createdBy: m1Id, createdAt: ys },
    { id: genId(), title: '更新招聘渠道投放策略', frequency: '月', priority: 'P2', dueDate: fut7, completed: false, createdBy: adminId, createdAt: now },
    { id: genId(), title: '与张主管对齐前端岗位面试标准', frequency: '日', priority: 'P1', dueDate: now, completed: true, createdBy: m1Id, createdAt: ys },
    { id: genId(), title: '提交本月招聘数据月报', frequency: '月', priority: 'P0', dueDate: fut7, completed: false, createdBy: adminId, createdAt: now }
  ];

  // Hires (with period-based follow-up)
  const h1Id = genId();
  db.hires = [
    { id: h1Id, name: '陈静', position: '产品经理', dept: '产品部', entryDate: '2026-07-15',
      periods: [
        { id: genId(), name: '第1周', templateId: tpl1Id, questions: tpl1Id ? db.templates.find(t=>t.id===tpl1Id)?.questions||[] : [],
          checkins: [
            { id: genId(), date: '2026-07-22', answers: { '0': '整体还可以', '1': '团队人都挺好的', '2': '比预期复杂一些', '3': '有些系统操作不太熟' }, feedback: '安排IT培训', notes: '适应能力不错' }
          ]
        },
        { id: genId(), name: '第2周', templateId: tpl1Id, questions: [],
          checkins: [
            { id: genId(), date: ys, answers: { '0': '比上周好多了', '1': '沟通挺好的', '2': '慢慢找到节奏了', '3': '暂时没问题' }, feedback: '', notes: '' }
          ]
        },
        { id: genId(), name: '第1个月', templateId: tpl2Id, questions: [],
          checkins: []
        }
      ],
      createdBy: adminId, createdAt: '2026-07-15' },
    { id: genId(), name: '刘洋', position: 'Java开发工程师', dept: '技术部', entryDate: '2026-07-22',
      periods: [
        { id: genId(), name: '第1周', templateId: tpl1Id, questions: [],
          checkins: [
            { id: genId(), date: '2026-07-29', answers: { '0': '挺适应的', '1': '技术氛围好', '2': '工作内容对胃口', '3': '代码规范还在熟悉中' }, feedback: '安排mentor带代码规范', notes: '技��底子不错' }
          ]
        },
        { id: genId(), name: '第2周', templateId: tpl1Id, questions: [], checkins: [] }
      ],
      createdBy: m1Id, createdAt: '2026-07-22' }
  ];

  // Progress table (matches the Excel template)
  db.progress = [
    { id: genId(), position: '软件销售', headcount: 2, priority: '高', urgency: '高', difficulty: '中',
      planNode: '8月7日前到岗1人，8月14日前到岗1人', week1: 0, week2: 0, week3: 0, week4: 0,
      totalEntry: 0, shortage: 2, completion: '0%', notes: '', createdBy: adminId, createdAt: now },
    { id: genId(), position: '产品经理', headcount: 1, priority: '中', urgency: '高', difficulty: '中',
      planNode: '', week1: 0, week2: 0, week3: 0, week4: 0,
      totalEntry: 0, shortage: 1, completion: '0%', notes: '', createdBy: adminId, createdAt: now },
    { id: genId(), position: '大数据开发', headcount: 2, priority: '高', urgency: '高', difficulty: '中',
      planNode: '', week1: 0, week2: 0, week3: 0, week4: 0,
      totalEntry: 0, shortage: 2, completion: '0%', notes: '', createdBy: adminId, createdAt: now },
    { id: genId(), position: '账务组长', headcount: 1, priority: '高', urgency: '高', difficulty: '中',
      planNode: '', week1: 0, week2: 0, week3: 0, week4: 0,
      totalEntry: 0, shortage: 1, completion: '0%', notes: '', createdBy: adminId, createdAt: now },
    { id: genId(), position: '财税顾问', headcount: 1, priority: '高', urgency: '高', difficulty: '中',
      planNode: '', week1: 0, week2: 0, week3: 0, week4: 0,
      totalEntry: 0, shortage: 1, completion: '0%', notes: '', createdBy: adminId, createdAt: now },
    { id: genId(), position: '财税助理', headcount: 2, priority: '中', urgency: '中', difficulty: '中',
      planNode: '', week1: 0, week2: 0, week3: 0, week4: 0,
      totalEntry: 0, shortage: 2, completion: '0%', notes: '', createdBy: adminId, createdAt: now }
  ];

  // Contracts (labor contracts)
  db.contracts = [
    { id: genId(), seq: 1, name: '李明', dept: '技术部', entryDate: '2026-07-01', signDate: '2026-07-01', duration: 1, endDate: '2027-07-01', signUnit: 'HR工作台有限公司', notes: '', createdBy: m1Id, createdAt: ys },
    { id: genId(), seq: 2, name: '王芳', dept: '人力资源部', entryDate: '2026-06-01', signDate: '2026-06-01', duration: 3, endDate: '2029-06-01', signUnit: 'HR工作台有限公司', notes: '三年期', createdBy: m1Id, createdAt: ys },
    { id: genId(), seq: 3, name: '测试员工', dept: '市场部', entryDate: '2026-07-01', signDate: '2026-07-01', duration: 1, endDate: '2026-08-08', signUnit: 'HR工作台有限公司', notes: '即将到期，需催办', createdBy: m1Id, createdAt: ys }
  ];

  saveDb();
  console.log('Database seeded with sample data');
  console.log(`Admin: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
  console.log('Member: zhangwei / 123456');
}

// ========== Auth Middleware ==========
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  const token = authHeader.slice(7);
  const userId = tokens[token];
  if (!userId) {
    return res.status(401).json({ error: '登录已过���，请重新登录' });
  }
  const user = db.users.find(u => u.id === userId);
  if (!user) {
    return res.status(401).json({ error: '用户不存在' });
  }
  req.user = user;
  req.userId = user.id;
  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '仅管理员可操作' });
  }
  next();
}

function contractAccess(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'contract_admin') {
    return res.status(403).json({ error: '无合同管理权限' });
  }
  next();
}

// ========== Auth Routes ==========
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '请输入用户名和密码' });
  }
  const user = db.users.find(u => u.username === username);
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const hashed = hashPass(password, user.salt);
  if (hashed !== user.password) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = genToken();
  tokens[token] = user.id;
  res.json({
    token,
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role
  });
});

app.post('/api/logout', authMiddleware, (req, res) => {
  // Remove all tokens for this user
  Object.keys(tokens).forEach(k => {
    if (tokens[k] === req.userId) delete tokens[k];
  });
  res.json({ ok: true });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({
    userId: req.user.id,
    username: req.user.username,
    displayName: req.user.displayName,
    role: req.user.role
  });
});

// ========== User Management (Admin only) ==========
app.get('/api/users', authMiddleware, adminOnly, (req, res) => {
  const users = db.users.map(u => ({
    id: u.id, username: u.username, displayName: u.displayName,
    role: u.role, createdAt: u.createdAt
  }));
  res.json(users);
});

app.post('/api/users', authMiddleware, adminOnly, (req, res) => {
  const { username, displayName, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (db.users.find(u => u.username === username)) {
    return res.status(400).json({ error: '用户名已存在' });
  }
  const salt = genSalt();
  const userRole = role === 'contract_admin' ? 'contract_admin' : 'member';
  const user = {
    id: genId(), username, displayName: displayName || username,
    role: userRole, salt, password: hashPass(password, salt),
    createdAt: new Date().toISOString().split('T')[0]
  };
  db.users.push(user);
  saveDb();
  res.json({ id: user.id, username: user.username, displayName: user.displayName, role: user.role });
});

app.delete('/api/users/:id', authMiddleware, adminOnly, (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.role === 'admin') return res.status(400).json({ error: '不能删除管理员' });
  db.users = db.users.filter(u => u.id !== req.params.id);
  // Clean up user's tokens
  Object.keys(tokens).forEach(k => {
    if (tokens[k] === req.params.id) delete tokens[k];
  });
  saveDb();
  res.json({ ok: true });
});

app.put('/api/users/:id/password', authMiddleware, adminOnly, (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: '密码不能为空' });
  const salt = genSalt();
  user.salt = salt;
  user.password = hashPass(password, salt);
  saveDb();
  res.json({ ok: true });
});

// Admin change own password
app.put('/api/me/password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (hashPass(oldPassword, user.salt) !== user.password) {
    return res.status(400).json({ error: '原密码错误' });
  }
  const salt = genSalt();
  user.salt = salt;
  user.password = hashPass(newPassword, salt);
  saveDb();
  res.json({ ok: true });
});

// ========== Helper: filter by user ==========
function filterByUser(arr, userId, role) {
  if (role === 'admin') return arr;
  // contract_admin sees system items + own items
  if (role === 'contract_admin') {
    return arr.filter(item => item.createdBy === userId || item.createdBy === 'system');
  }
  return arr.filter(item => item.createdBy === userId);
}

// ========== Positions ==========
app.get('/api/positions', authMiddleware, (req, res) => {
  res.json(filterByUser(db.positions, req.userId, req.user.role));
});

app.post('/api/positions', authMiddleware, adminOnly, (req, res) => {
  const pos = {
    id: genId(), ...req.body,
    stages: req.body.stages || { resumeScreen: 0, firstInterview: 0, secondInterview: 0, finalInterview: 0, offer: 0, onboard: 0 },
    status: 'active', createdBy: req.userId,
    createdAt: new Date().toISOString().split('T')[0]
  };
  db.positions.unshift(pos);
  // Sync onboard to progress table if exists
  syncOnboardToProgress(pos.position, pos.stages.onboard || 0);
  saveDb();
  res.json(pos);
});

app.put('/api/positions/:id', authMiddleware, adminOnly, (req, res) => {
  const idx = db.positions.findIndex(p => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '岗位不存在' });
  const oldPos = db.positions[idx].position;
  db.positions[idx] = { ...db.positions[idx], ...req.body };
  const newPos = db.positions[idx];
  // If position name changed, sync to progress
  if (req.body.position && req.body.position !== oldPos) {
    const prog = db.progress.find(p => p.position === oldPos);
    if (prog) prog.position = req.body.position;
  }
  // Sync onboard to progress
  if (req.body.stages && req.body.stages.onboard !== undefined) {
    syncOnboardToProgress(newPos.position, newPos.stages.onboard || 0);
  }
  saveDb();
  res.json(db.positions[idx]);
});

app.delete('/api/positions/:id', authMiddleware, adminOnly, (req, res) => {
  db.positions = db.positions.filter(p => p.id !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

app.post('/api/positions/batch-delete', authMiddleware, adminOnly, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '请提供要删除的ID' });
  const before = db.positions.length;
  db.positions = db.positions.filter(p => !ids.includes(p.id));
  saveDb();
  res.json({ ok: true, removed: before - db.positions.length });
});

// Batch import positions from CSV/array
app.post('/api/positions/batch-import', authMiddleware, adminOnly, (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '请提供数据数组' });
  }
  let added = 0, updated = 0;
  items.forEach(item => {
    if (!item.position) return;
    const existing = db.positions.find(p => p.position === item.position);
    if (existing) {
      // Update existing
      if (item.dept !== undefined) existing.dept = item.dept;
      if (item.headcount !== undefined) existing.headcount = parseInt(item.headcount, 10);
      if (isNaN(existing.headcount) || existing.headcount < 0) existing.headcount = 1;
      if (item.deadline !== undefined) existing.deadline = item.deadline;
      if (item.stages) {
        existing.stages = { ...existing.stages, ...item.stages };
        syncOnboardToProgress(existing.position, existing.stages.onboard || 0);
      }
      updated++;
    } else {
      // Create new
      const newPos = {
        id: genId(),
        position: item.position,
        dept: item.dept || '',
        headcount: parseInt(item.headcount) || 1,
        deadline: item.deadline || '',
        stages: item.stages || { resumeScreen: 0, firstInterview: 0, secondInterview: 0, finalInterview: 0, offer: 0, onboard: 0 },
        status: 'active',
        createdBy: req.userId,
        createdAt: new Date().toISOString().split('T')[0]
      };
      db.positions.unshift(newPos);
      syncOnboardToProgress(newPos.position, newPos.stages.onboard || 0);
      added++;
    }
  });
  saveDb();
  res.json({ ok: true, added, updated, total: added + updated });
});

// Helper: sync onboard count to progress table
function syncOnboardToProgress(positionName, onboardCount) {
  const prog = db.progress.find(p => p.position === positionName);
  if (!prog) return;
  prog.totalEntry = onboardCount;
  prog.shortage = Math.max(0, (prog.headcount || 0) - onboardCount);
  prog.completion = prog.headcount > 0 ? Math.round(onboardCount / prog.headcount * 100) + '%' : '0%';
}

// ========== Interviews ==========
app.get('/api/interviews', authMiddleware, (req, res) => {
  res.json(filterByUser(db.interviews, req.userId, req.user.role));
});

app.post('/api/interviews', authMiddleware, (req, res) => {
  const iv = {
    id: genId(), ...req.body,
    createdBy: req.userId,
    createdAt: new Date().toISOString().split('T')[0]
  };
  db.interviews.unshift(iv);
  saveDb();
  res.json(iv);
});

app.post('/api/interviews/batch', authMiddleware, (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '请提供有效的面试数据' });
  }
  const now = new Date().toISOString().split('T')[0];
  const added = items.map(item => ({
    id: genId(), ...item,
    createdBy: req.userId, createdAt: now
  }));
  db.interviews.unshift(...added);
  saveDb();
  res.json({ count: added.length });
});

// Batch upsert: update existing (by phone or name+position) or add new
app.post('/api/interviews/batch-upsert', authMiddleware, (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '请提供有效的面试数据' });
  }
  const now = new Date().toISOString().split('T')[0];
  let updated = 0, added = 0;
  items.forEach(item => {
    // Match by phone first, then by name+position
    let existing = null;
    if (item.phone) {
      existing = db.interviews.find(iv =>
        iv.phone === item.phone && (iv.createdBy === req.userId || req.user.role === 'admin')
      );
    }
    if (!existing && item.name && item.position) {
      existing = db.interviews.find(iv =>
        iv.name === item.name && iv.position === item.position && (iv.createdBy === req.userId || req.user.role === 'admin')
      );
    }
    if (existing) {
      Object.assign(existing, item, { updatedAt: now });
      updated++;
    } else {
      db.interviews.unshift({ id: genId(), ...item, createdBy: req.userId, createdAt: now });
      added++;
    }
  });
  saveDb();
  res.json({ added, updated });
});

app.put('/api/interviews/:id', authMiddleware, (req, res) => {
  const idx = db.interviews.findIndex(iv => iv.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '面试记录不存在' });
  if (req.user.role !== 'admin' && db.interviews[idx].createdBy !== req.userId) {
    return res.status(403).json({ error: '无权修改他人记录' });
  }
  db.interviews[idx] = { ...db.interviews[idx], ...req.body };
  // Auto-sync to progress table if result changed to "通过"
  if (req.body.result === '通过') {
    syncProgressFromInterview(db.interviews[idx]);
  }
  saveDb();
  res.json(db.interviews[idx]);
});

app.delete('/api/interviews/:id', authMiddleware, (req, res) => {
  const iv = db.interviews.find(iv => iv.id === req.params.id);
  if (!iv) return res.status(404).json({ error: '面试记录不存在' });
  if (req.user.role !== 'admin' && iv.createdBy !== req.userId) {
    return res.status(403).json({ error: '无权删除他人记录' });
  }
  db.interviews = db.interviews.filter(iv => iv.id !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

app.post('/api/interviews/batch-delete', authMiddleware, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '请提供要删除的ID' });
  const before = db.interviews.length;
  if (req.user.role === 'admin') {
    db.interviews = db.interviews.filter(iv => !ids.includes(iv.id));
  } else {
    db.interviews = db.interviews.filter(iv => !ids.includes(iv.id) || iv.createdBy !== req.userId);
  }
  saveDb();
  res.json({ ok: true, removed: before - db.interviews.length });
});

// ========== Contracts (Labor Contracts) ==========
app.get('/api/contracts', authMiddleware, contractAccess, (req, res) => {
  res.json(db.contracts || []);
});

app.post('/api/contracts', authMiddleware, contractAccess, (req, res) => {
  const ct = computeEndDate({ id: genId(), ...req.body, createdBy: req.userId, createdAt: new Date().toISOString().split('T')[0] });
  if (!db.contracts) db.contracts = [];
  db.contracts.unshift(ct);
  saveDb();
  syncContractTodos();
  res.json(ct);
});

app.post('/api/contracts/batch', authMiddleware, contractAccess, (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: '请提供数据' });
  if (!db.contracts) db.contracts = [];
  const now = new Date().toISOString().split('T')[0];
  const added = items.map((item, i) => computeEndDate({ id: genId(), seq: item.seq || (i + 1), ...item, createdBy: req.userId, createdAt: now }));
  db.contracts.unshift(...added);
  saveDb();
  syncContractTodos();
  res.json({ count: added.length });
});

app.put('/api/contracts/:id', authMiddleware, contractAccess, (req, res) => {
  if (!db.contracts) db.contracts = [];
  const idx = db.contracts.findIndex(c => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '合同不存在' });
  db.contracts[idx] = computeEndDate({ ...db.contracts[idx], ...req.body });
  saveDb();
  syncContractTodos();
  res.json(db.contracts[idx]);
});

app.delete('/api/contracts/:id', authMiddleware, contractAccess, (req, res) => {
  if (!db.contracts) db.contracts = [];
  db.contracts = db.contracts.filter(c => c.id !== req.params.id);
  saveDb();
  syncContractTodos();
  res.json({ ok: true });
});

app.post('/api/contracts/batch-delete', authMiddleware, contractAccess, (req, res) => {
  if (!db.contracts) db.contracts = [];
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '请提供要删除的ID' });
  const before = db.contracts.length;
  db.contracts = db.contracts.filter(c => !ids.includes(c.id));
  saveDb();
  syncContractTodos();
  res.json({ ok: true, removed: before - db.contracts.length });
});

// Auto-sync contract expiry to todos
function syncContractTodos() {
  if (!db.contracts || db.contracts.length === 0) return;
  const today = new Date(); today.setHours(0,0,0,0);
  // Remove old auto-generated contract todos
  db.todos = db.todos.filter(t => !t._autoContractId);
  
  db.contracts.forEach(ct => {
    if (!ct.endDate) return;
    const endDate = new Date(ct.endDate); endDate.setHours(0,0,0,0);
    const daysUntil = Math.ceil((endDate - today) / 86400000);
    // Create reminder todo 7 days before expiry
    if (daysUntil <= 15 && daysUntil >= 0) {
      const dueDate = new Date(today);
      dueDate.setDate(dueDate.getDate() + Math.max(0, daysUntil));
      db.todos.push({
        id: genId(), title: `📋 ${ct.name} 合同${daysUntil===0?'今天':daysUntil+'天后'}到期 (${ct.endDate})`,
        frequency: '日', priority: daysUntil <= 3 ? 'P0' : 'P1',
        dueDate: dueDate.toISOString().split('T')[0], completed: false,
        createdBy: 'system', createdAt: today.toISOString().split('T')[0],
        _autoContractId: ct.id
      });
    }
  });
  saveDb();
}

// Auto-compute endDate from signDate + duration if missing
function computeEndDate(item) {
  if (item.endDate) return item;
  if (item.signDate && item.duration && !isNaN(parseInt(item.duration))) {
    const d = new Date(item.signDate);
    d.setFullYear(d.getFullYear() + parseInt(item.duration));
    item.endDate = d.toISOString().split('T')[0];
  }
  return item;
}

// ========== Todos ==========
app.get('/api/todos', authMiddleware, (req, res) => {
  res.json(filterByUser(db.todos, req.userId, req.user.role));
});

app.post('/api/todos', authMiddleware, (req, res) => {
  const todo = {
    id: genId(), ...req.body,
    completed: false, createdBy: req.userId,
    createdAt: new Date().toISOString().split('T')[0]
  };
  db.todos.unshift(todo);
  saveDb();
  res.json(todo);
});

app.put('/api/todos/:id', authMiddleware, (req, res) => {
  const idx = db.todos.findIndex(t => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '待办不存在' });
  if (req.user.role !== 'admin' && db.todos[idx].createdBy !== req.userId) {
    return res.status(403).json({ error: '无权修改他人记录' });
  }
  db.todos[idx] = { ...db.todos[idx], ...req.body };
  // If marked complete, set completedAt
  if (req.body.completed && !db.todos[idx].completedAt) {
    db.todos[idx].completedAt = new Date().toISOString().split('T')[0];
  }
  if (req.body.completed === false) {
    db.todos[idx].completedAt = null;
  }
  saveDb();
  res.json(db.todos[idx]);
});

app.delete('/api/todos/:id', authMiddleware, (req, res) => {
  const todo = db.todos.find(t => t.id === req.params.id);
  if (!todo) return res.status(404).json({ error: '待办不存在' });
  if (req.user.role !== 'admin' && todo.createdBy !== req.userId) {
    return res.status(403).json({ error: '无权删除他人记录' });
  }
  db.todos = db.todos.filter(t => t.id !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

// ========== Templates ==========
app.get('/api/templates', authMiddleware, (req, res) => {
  // Templates are shared - all users can see them
  res.json(db.templates);
});

app.post('/api/templates', authMiddleware, (req, res) => {
  const tpl = {
    id: genId(), ...req.body,
    createdBy: req.userId,
    createdAt: new Date().toISOString().split('T')[0]
  };
  db.templates.push(tpl);
  saveDb();
  res.json(tpl);
});

app.put('/api/templates/:id', authMiddleware, (req, res) => {
  const idx = db.templates.findIndex(t => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '模板不存在' });
  db.templates[idx] = { ...db.templates[idx], ...req.body };
  saveDb();
  res.json(db.templates[idx]);
});

app.delete('/api/templates/:id', authMiddleware, (req, res) => {
  db.templates = db.templates.filter(t => t.id !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

app.post('/api/templates/:id/clone', authMiddleware, (req, res) => {
  const tpl = db.templates.find(t => t.id === req.params.id);
  if (!tpl) return res.status(404).json({ error: '模板不存在' });
  const cloned = {
    id: genId(),
    name: (tpl.name || '模板') + ' (副本)',
    questions: [...(tpl.questions || [])],
    createdBy: req.userId,
    createdAt: new Date().toISOString().split('T')[0]
  };
  db.templates.push(cloned);
  saveDb();
  res.json(cloned);
});

// ========== Hires & Periods ==========
// Migration: convert old hires with top-level checkins to periods format
function migrateHires() {
  let migrated = false;
  db.hires.forEach(h => {
    if (h.checkins && !h.periods) {
      h.periods = [{
        id: genId(), name: '随访记录', templateId: h.templateId || '',
        questions: [], checkins: (h.checkins || []).map(c => ({ ...c, id: c.id || genId() }))
      }];
      delete h.checkins;
      migrated = true;
    }
    // Ensure periods have ids
    if (h.periods) {
      h.periods.forEach(p => { if (!p.id) p.id = genId(); });
    }
  });
  if (migrated) { saveDb(); console.log('Migrated hires to periods format'); }
}

// Progress: auto-sync from interviews
function syncProgressFromInterview(interview) {
  if (!interview || interview.result !== '通过') return;
  const progressItem = db.progress.find(p => p.position === interview.position);
  if (!progressItem) return;
  // Determine which week based on interview date
  const ivDate = new Date(interview.firstInterviewDate || interview.interviewDate);
  const weekNum = Math.ceil((ivDate.getDate()) / 7);
  if (weekNum >= 1 && weekNum <= 4) {
    const weekKey = 'week' + weekNum;
    progressItem[weekKey] = (progressItem[weekKey] || 0) + 1;
    progressItem.totalEntry = (progressItem.week1||0) + (progressItem.week2||0) + (progressItem.week3||0) + (progressItem.week4||0);
    progressItem.shortage = Math.max(0, (progressItem.headcount||0) - progressItem.totalEntry);
    progressItem.completion = progressItem.headcount > 0 ? Math.round(progressItem.totalEntry / progressItem.headcount * 100) + '%' : '0%';
    saveDb();
  }
}

app.get('/api/hires', authMiddleware, (req, res) => {
  res.json(filterByUser(db.hires, req.userId, req.user.role));
});

app.post('/api/hires', authMiddleware, (req, res) => {
  const hire = {
    id: genId(), ...req.body,
    periods: req.body.periods || [],
    createdBy: req.userId,
    createdAt: new Date().toISOString().split('T')[0]
  };
  db.hires.unshift(hire);
  saveDb();
  res.json(hire);
});

app.put('/api/hires/:id', authMiddleware, (req, res) => {
  const idx = db.hires.findIndex(h => h.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '新人记录不存在' });
  if (req.user.role !== 'admin' && db.hires[idx].createdBy !== req.userId) {
    return res.status(403).json({ error: '无权修改他人记录' });
  }
  db.hires[idx] = { ...db.hires[idx], ...req.body };
  saveDb();
  res.json(db.hires[idx]);
});

app.delete('/api/hires/:id', authMiddleware, (req, res) => {
  const hire = db.hires.find(h => h.id === req.params.id);
  if (!hire) return res.status(404).json({ error: '新人记录不存在' });
  if (req.user.role !== 'admin' && hire.createdBy !== req.userId) {
    return res.status(403).json({ error: '无权删除他人记录' });
  }
  db.hires = db.hires.filter(h => h.id !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

// Period management
app.post('/api/hires/:id/periods', authMiddleware, (req, res) => {
  const hire = db.hires.find(h => h.id === req.params.id);
  if (!hire) return res.status(404).json({ error: '新人记录不存在' });
  if (req.user.role !== 'admin' && hire.createdBy !== req.userId) {
    return res.status(403).json({ error: '无权操作' });
  }
  if (!hire.periods) hire.periods = [];
  const period = { id: genId(), ...req.body, checkins: [] };
  hire.periods.push(period);
  saveDb();
  res.json(hire);
});

app.put('/api/hires/:id/periods/:pid', authMiddleware, (req, res) => {
  const hire = db.hires.find(h => h.id === req.params.id);
  if (!hire) return res.status(404).json({ error: '新人记录不存在' });
  const period = (hire.periods||[]).find(p => p.id === req.params.pid);
  if (!period) return res.status(404).json({ error: '周期不存在' });
  Object.assign(period, req.body);
  saveDb();
  res.json(hire);
});

app.delete('/api/hires/:id/periods/:pid', authMiddleware, (req, res) => {
  const hire = db.hires.find(h => h.id === req.params.id);
  if (!hire) return res.status(404).json({ error: '新人记录不存在' });
  hire.periods = (hire.periods||[]).filter(p => p.id !== req.params.pid);
  saveDb();
  res.json(hire);
});

// Checkin within a period
app.post('/api/hires/:id/periods/:pid/checkins', authMiddleware, (req, res) => {
  const hire = db.hires.find(h => h.id === req.params.id);
  if (!hire) return res.status(404).json({ error: '新人记录不存在' });
  if (req.user.role !== 'admin' && hire.createdBy !== req.userId) {
    return res.status(403).json({ error: '无权操作' });
  }
  const period = (hire.periods||[]).find(p => p.id === req.params.pid);
  if (!period) return res.status(404).json({ error: '周期不存在' });
  period.checkins.push({ id: genId(), ...req.body });
  saveDb();
  res.json(hire);
});

// ========== Progress Table (Recruitment Progress) ==========
app.get('/api/progress', authMiddleware, (req, res) => {
  // Progress table is shared across all users
  res.json(db.progress);
});

app.post('/api/progress/sync', authMiddleware, adminOnly, (req, res) => {
  // Auto-sync: recalculate all progress from interview data
  db.progress.forEach(p => {
    p.week1 = 0; p.week2 = 0; p.week3 = 0; p.week4 = 0;
    db.interviews.filter(iv => iv.result === '通过' && iv.position === p.position).forEach(iv => {
      const d = new Date(iv.interviewDate).getDate();
      const wk = Math.ceil(d / 7);
      if (wk >= 1 && wk <= 4) p['week' + wk] = (p['week' + wk] || 0) + 1;
    });
    p.totalEntry = (p.week1||0) + (p.week2||0) + (p.week3||0) + (p.week4||0);
    p.shortage = Math.max(0, (p.headcount||0) - p.totalEntry);
    p.completion = p.headcount > 0 ? Math.round(p.totalEntry / p.headcount * 100) + '%' : '0%';
  });
  saveDb();
  res.json({ ok: true, count: db.progress.length });
});

app.post('/api/progress', authMiddleware, adminOnly, (req, res) => {
  const item = {
    id: genId(), ...req.body,
    createdBy: req.userId,
    createdAt: new Date().toISOString().split('T')[0]
  };
  db.progress.push(item);
  // Auto-create position in board if not exists
  const existingPos = db.positions.find(p => p.position === item.position);
  if (!existingPos) {
    db.positions.unshift({
      id: genId(), position: item.position, dept: item.dept || '',
      headcount: item.headcount || 0, deadline: '',
      stages: { resumeScreen: 0, firstInterview: 0, secondInterview: 0, finalInterview: 0, offer: 0, onboard: item.totalEntry || 0 },
      status: 'active', createdBy: req.userId, createdAt: new Date().toISOString().split('T')[0]
    });
  }
  saveDb();
  res.json(item);
});

app.put('/api/progress/:id', authMiddleware, (req, res) => {
  // Progress table is shared - all authenticated users can update
  const idx = db.progress.findIndex(p => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '不存在' });
  const oldName = db.progress[idx].position;
  db.progress[idx] = { ...db.progress[idx], ...req.body };
  // Recalculate totals
  const p = db.progress[idx];
  p.totalEntry = (p.week1||0) + (p.week2||0) + (p.week3||0) + (p.week4||0);
  p.shortage = Math.max(0, (p.headcount||0) - p.totalEntry);
  p.completion = p.headcount > 0 ? Math.round(p.totalEntry / p.headcount * 100) + '%' : '0%';
  // Sync position name change to board
  if (req.body.position && req.body.position !== oldName) {
    const pos = db.positions.find(x => x.position === oldName);
    if (pos) pos.position = req.body.position;
  }
  // Sync headcount to board
  if (req.body.headcount !== undefined) {
    const pos = db.positions.find(x => x.position === p.position);
    if (pos) pos.headcount = req.body.headcount;
  }
  // Sync totalEntry/onboard to board
  const pos = db.positions.find(x => x.position === p.position);
  if (pos) {
    pos.stages = pos.stages || {};
    pos.stages.onboard = p.totalEntry || 0;
  }
  saveDb();
  res.json(db.progress[idx]);
});

app.delete('/api/progress/:id', authMiddleware, adminOnly, (req, res) => {
  db.progress = db.progress.filter(p => p.id !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

// Batch import progress from CSV/array
app.post('/api/progress/batch-import', authMiddleware, (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '请提供数据数组' });
  }
  let added = 0, updated = 0;
  items.forEach(item => {
    if (!item.position) return;
    const existing = db.progress.find(p => p.position === item.position);
    if (existing) {
      // Update existing
      if (item.headcount !== undefined) existing.headcount = parseInt(item.headcount) || existing.headcount;
      if (item.priority !== undefined) existing.priority = item.priority;
      if (item.urgency !== undefined) existing.urgency = item.urgency;
      if (item.difficulty !== undefined) existing.difficulty = item.difficulty;
      if (item.milestone !== undefined) existing.milestone = item.milestone;
      if (item.week1 !== undefined) existing.week1 = parseInt(item.week1) || 0;
      if (item.week2 !== undefined) existing.week2 = parseInt(item.week2) || 0;
      if (item.week3 !== undefined) existing.week3 = parseInt(item.week3) || 0;
      if (item.week4 !== undefined) existing.week4 = parseInt(item.week4) || 0;
      if (item.note !== undefined) existing.note = item.note;
      // Recalculate
      existing.totalEntry = (existing.week1||0) + (existing.week2||0) + (existing.week3||0) + (existing.week4||0);
      existing.shortage = Math.max(0, (existing.headcount||0) - existing.totalEntry);
      existing.completion = existing.headcount > 0 ? Math.round(existing.totalEntry / existing.headcount * 100) + '%' : '0%';
      updated++;
    } else {
      // Create new
      const headcount = parseInt(item.headcount) || 1;
      const w1 = parseInt(item.week1) || 0;
      const w2 = parseInt(item.week2) || 0;
      const w3 = parseInt(item.week3) || 0;
      const w4 = parseInt(item.week4) || 0;
      const totalEntry = w1 + w2 + w3 + w4;
      db.progress.push({
        id: genId(),
        position: item.position,
        headcount,
        priority: item.priority || '中',
        urgency: item.urgency || '中',
        difficulty: item.difficulty || '中',
        milestone: item.milestone || '',
        week1: w1, week2: w2, week3: w3, week4: w4,
        totalEntry,
        shortage: Math.max(0, headcount - totalEntry),
        completion: headcount > 0 ? Math.round(totalEntry / headcount * 100) + '%' : '0%',
        note: item.note || '',
        createdBy: req.userId,
        createdAt: new Date().toISOString().split('T')[0]
      });
      added++;
    }
  });
  saveDb();
  res.json({ ok: true, added, updated, total: added + updated });
});

// ========== LocalStorage Migration ==========
app.post('/api/migrate', authMiddleware, (req, res) => {
  const data = req.body;
  const now = new Date().toISOString().split('T')[0];
  let count = 0;
  
  // Migrate templates (shared, add if not exists)
  if (Array.isArray(data.templates)) {
    data.templates.forEach(tpl => {
      if (!db.templates.find(t => t.name === tpl.name)) {
        db.templates.push({ ...tpl, id: genId(), createdBy: req.userId, createdAt: now });
        count++;
      }
    });
  }
  
  // Migrate positions (admin-created data)
  if (Array.isArray(data.positions)) {
    data.positions.forEach(p => {
      db.positions.unshift({ ...p, id: genId(), createdBy: req.userId, createdAt: now });
      count++;
    });
  }
  
  // Migrate interviews (own data)
  if (Array.isArray(data.interviews)) {
    data.interviews.forEach(iv => {
      db.interviews.unshift({ ...iv, id: genId(), createdBy: req.userId, createdAt: now });
      count++;
    });
  }
  
  // Migrate todos (own data)
  if (Array.isArray(data.todos)) {
    data.todos.forEach(td => {
      db.todos.unshift({ ...td, id: genId(), createdBy: req.userId, createdAt: now });
      count++;
    });
  }
  
  // Migrate hires (convert old format to periods if needed)
  if (Array.isArray(data.hires)) {
    data.hires.forEach(h => {
      // If old format with top-level checkins, convert to periods
      if (h.checkins && !h.periods) {
        h.periods = [{ id: genId(), name: '随访记录', templateId: h.templateId || '', questions: [], checkins: h.checkins }];
        delete h.checkins;
      }
      if (!h.periods) h.periods = [];
      db.hires.unshift({ ...h, id: genId(), createdBy: req.userId, createdAt: now });
      count++;
    });
  }
  
  saveDb();
  res.json({ count, message: `成功迁移 ${count} 条数据` });
});

// ========== Data Export/Import (Admin only) ==========
app.get('/api/export', authMiddleware, adminOnly, (req, res) => {
  const exportData = {
    positions: db.positions,
    interviews: db.interviews,
    todos: db.todos,
    templates: db.templates,
    hires: db.hires,
    progress: db.progress,
    contracts: db.contracts || [],
    exportedAt: new Date().toISOString(),
    version: '2.0'
  };
  res.json(exportData);
});

app.post('/api/import', authMiddleware, adminOnly, (req, res) => {
  const data = req.body;
  let count = 0;
  if (data.positions) { db.positions = data.positions; count += data.positions.length; }
  if (data.interviews) { db.interviews = data.interviews; count += data.interviews.length; }
  if (data.todos) { db.todos = data.todos; count += data.todos.length; }
  if (data.templates) { db.templates = data.templates; count += data.templates.length; }
  if (data.hires) { db.hires = data.hires; count += data.hires.length; }
  if (data.progress) { db.progress = data.progress; count += data.progress.length; }
  if (data.contracts) { db.contracts = data.contracts; count += data.contracts.length; }
  saveDb();
  res.json({ count });
});

// ========== SPA fallback ==========
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Migrate old interview fields to new schema
function migrateInterviews() {
  let migrated = false;
  db.interviews.forEach(iv => {
    if (iv.interviewType !== undefined) {
      // Old schema detected — remap fields
      if (!iv.firstInterviewDate) iv.firstInterviewDate = iv.interviewDate || '';
      if (!iv.education) iv.education = '';
      if (!iv.gender) iv.gender = '';
      if (!iv.inviter) iv.inviter = '';
      if (!iv.secondInterviewDate) iv.secondInterviewDate = '';
      if (!iv.expectedOnboardDate) iv.expectedOnboardDate = '';
      delete iv.interviewType;
      delete iv.email;
      migrated = true;
    }
    // Ensure all new fields exist
    iv.education = iv.education || '';
    iv.gender = iv.gender || '';
    iv.inviter = iv.inviter || '';
    iv.firstInterviewDate = iv.firstInterviewDate || '';
    iv.secondInterviewDate = iv.secondInterviewDate || '';
    iv.expectedOnboardDate = iv.expectedOnboardDate || '';
    if (iv.interviewDate) { iv.firstInterviewDate = iv.firstInterviewDate || iv.interviewDate; }
    delete iv.interviewDate;
    delete iv.email;
  });
  if (migrated) { saveDb(); console.log('Migrated interviews to new schema'); }
}

// Migrate templates: ensure every template has a category field
function migrateTemplates() {
  let migrated = false;
  db.templates.forEach(t => {
    if (!t.category) {
      // Auto-categorize based on name
      const name = t.name || '';
      if (name.includes('销售') || name.includes('商务') || name.includes('BD')) t.category = '销售';
      else if (name.includes('顾问') || name.includes('咨询')) t.category = '顾问';
      else if (name.includes('技术') || name.includes('前端') || name.includes('开发') || name.includes('工程师')) t.category = '技术';
      else if (name.includes('运营')) t.category = '运营';
      else if (name.includes('管理') || name.includes('总监') || name.includes('经理')) t.category = '管理';
      else t.category = '未分类';
      migrated = true;
    }
  });
  if (migrated) { saveDb(); console.log('Migrated templates: added category field'); }
}

// ========== Start ==========
(async () => {
  await initStore();
  if (!db.contracts) db.contracts = [];
  migrateHires();
  migrateInterviews();
  migrateTemplates();
  seedDb();

  // Health endpoint for Koyeb/Render wake-up + monitoring
  app.get('/health', (req, res) => {
    res.json({ ok: true, ts: Date.now(), store: usePg ? 'postgres' : 'file', interviews: db.interviews.length, positions: db.positions.length });
  });

  app.listen(PORT, () => {
    console.log(`HR Workbench server running on http://localhost:${PORT} (store: ${usePg ? 'postgres' : 'file'})`);
    console.log(`Admin: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
    console.log(`Member demo: zhangwei / 123456`);
  }).on('clientError', (err, socket) => {
    // Suppress parse errors from browsers sending extra data (harmless noise)
    if (!err.message || !err.message.includes('Parse Error')) {
      console.error('clientError:', err.message);
    }
    socket.destroy();
  });
})();

// Prevent unhandled rejections/exceptions from crashing the server
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason && reason.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  // Don't exit - let PM2 handle restart if needed
});
