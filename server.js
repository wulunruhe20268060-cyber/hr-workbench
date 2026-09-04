const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const docxExport = require('./docxExport');

// ========== Proxy support for outbound fetch (AI calls) ==========
// Node's global fetch (undici) ignores HTTP(S)_PROXY by default. When a system
// proxy is present (e.g. corporate/sandbox egress), route AI calls through it so
// external gateways (vercel/openai) become reachable. On hosts without a proxy
// (e.g. Render) this is a no-op and calls go direct.
(function setupProxy() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!proxy) return;
  try {
    const { ProxyAgent, setGlobalDispatcher } = require('undici');
    setGlobalDispatcher(new ProxyAgent(proxy));
    console.log('[proxy] outbound fetch will use proxy:', proxy);
  } catch (e) {
    console.log('[proxy] undici not available, skipping proxy setup:', e.message);
  }
})();

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
let db = { users: [], positions: [], interviews: [], todos: [], templates: [], hires: [], progress: [], contracts: [], jobSpecs: [], candidates: [], questionBanks: [], hiringDecisions: [], probations: [], boardHistory: [] };
let tokens = {};

// ---- Postgres (optional): used when DATABASE_URL is set, else falls back to JSON file ----
// On Koyeb free tier, attach the free Postgres database and set DATABASE_URL to persist data
// across redeploys. Any Postgres error automatically degrades to the file store (no crash).
let pgClient = null;
let usePg = false;
let lastPgError = '';
let migratedFromFile = false;

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
        // 一次性迁移：若本地文件已有数据，先载入并立即落库，避免从文件存储切换到 Postgres 时丢失
        try {
          if (fs.existsSync(DB_PATH)) {
            const fileDb = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
            if (fileDb && Object.keys(fileDb).length) {
              db = fileDb;
              migratedFromFile = true;
              console.log('Loaded existing file data for one-time migration into Postgres');
            }
          }
        } catch (e) { console.error('file->pg migration read error:', e.message); }
      }
      usePg = true;
      return;
    } catch (e) {
      lastPgError = e.message;
      console.error('Postgres init failed, falling back to FILE store:', e.message);
      console.error('⚠️ 未使用持久化数据库：当前为文件存储(data/db.json)。在 Render 等临时文件系统的平台上，每次重新部署都会清空数据！请检查 DATABASE_URL 是否正确（推荐 Neon/Render 免费 Postgres）。');
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
let bootFreshSeed = false;
function seedDb() {
  if (db.users.length > 0) return;
  bootFreshSeed = true;
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
      result: '待面试', departureDate: '', notes: '5年React经验，有大厂背景',
      createdBy: m1Id, createdAt: ys },
    { id: genId(), name: '王芳', position: 'HRBP', phone: '13987654321',
      education: '硕士', gender: '女', inviter: '李总监', source: '猎头推荐',
      firstInterviewDate: ys, secondInterviewDate: '', interviewer: '李总监',
      result: '通过', departureDate: '', notes: '沟通能力强，6年HR经验',
      createdBy: m1Id, createdAt: '2026-07-28' },
    { id: genId(), name: '张伟面试', position: '市场运营经理', phone: '13611112222',
      education: '本科', gender: '男', inviter: '王总', source: '内推',
      firstInterviewDate: '2026-07-20', secondInterviewDate: '2026-07-25', interviewer: '王总',
      result: '待定', departureDate: '', notes: '需确认薪资期望',
      createdBy: adminId, createdAt: '2026-07-18' },
    { id: genId(), name: '赵雪', position: '高级前端工程师', phone: '13733334444',
      education: '大专', gender: '女', inviter: '张主管', source: '拉勾',
      firstInterviewDate: ys, secondInterviewDate: '', interviewer: '张主管',
      result: '淘汰', departureDate: '', notes: '技术基础偏弱',
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

  // AI Recruitment Assistant demo seed (job spec sample)
  db.jobSpecs = [
    { id: genId(), position: 'HRBP', dept: '人力资源部', level: '中级',
      responsibilities: '负责业务部门的HR伙伴工作，包含招聘、员工关系、组织氛围建设',
      jd: 'HRBP 岗位说明书（示例）：负责对接业务部门，提供人力资源解决方案，推动人才梯队建设，优化组织效能。',
      competencies: [
        { name: '硬技能', weight: 40, items: [{ name: '劳动法合规', desc: '熟悉劳动合同法及用工风险' }, { name: '数据分析', desc: '能用数据驱动HR决策' }] },
        { name: '软技能', weight: 35, items: [{ name: '沟通协调', desc: '跨部门高效沟通' }, { name: '影响力', desc: '推动业务负责人行动' }] },
        { name: '职业素养', weight: 25, items: [{ name: '保密意识', desc: '严守薪酬与人事信息保密' }, { name: '责任心', desc: '对结果负责' }] }
      ],
      createdBy: adminId, createdAt: now }
  ];

  saveDb();
  console.log('Database seeded with sample data');
  console.log(`Admin: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
  console.log('Member: zhangwei / 123456');
}

// 确保默认成员始终存在：每次启动检查，缺失则补建。
// 这样无论本地文件存储还是切到 Postgres，重部署都不会丢失成员账号与权限。
function ensureDefaultUsers() {
  // 王燕(wangyan) 默认设为「合同管理员」(contract_admin)，拥有合同管理模块权限。
  const defaults = [
    { username: 'shijun', password: 'shijun123', role: 'member', displayName: '施骏' },
    { username: 'wangyan', password: 'wangyan123', role: 'contract_admin', displayName: '王燕' },
    { username: 'zhangliwen', password: 'zhangliwen123', role: 'member', displayName: '张丽雯' }
  ];
  let changed = false;
  for (const u of defaults) {
    if (db.users.find(x => x.username === u.username)) continue;
    const salt = genSalt();
    db.users.push({
      id: genId(), username: u.username, role: u.role,
      salt, password: hashPass(u.password, salt), displayName: u.displayName
    });
    changed = true;
    console.log(`Ensured default member: ${u.username} / ${u.displayName} (role=${u.role})`);
  }
  // 对已存在但仍是「普通成员」的王燕，按默认升级为合同管理员（仅升级、不降级，避免覆盖管理员的主动调整）。
  const wangyan = db.users.find(u => u.username === 'wangyan');
  if (wangyan && wangyan.role === 'member') {
    wangyan.role = 'contract_admin';
    changed = true;
    console.log('王燕 (wangyan) 已按默认升级为合同管理员 contract_admin');
  }
  // 旧字段清理：历史「拟入职时间(expectedOnboardDate)」已废弃，界面改为「离职时间(departureDate)」。
  // ⚠️ 不把 expectedOnboardDate 的值拷贝到 departureDate —— 那是"计划入职"日期而非离职日期，
  //    拷贝会把历史计划入职日（如"7.6号"）误判为已离职，导致误删随访记录/误计流失。
  //    兜底清理新插入行；常规清理由 migrateInterviews() 在启动时统一执行。
  db.interviews.forEach(iv => {
    if (iv.expectedOnboardDate !== undefined) {
      delete iv.expectedOnboardDate;
      changed = true;
    }
    if (iv.departureDate === undefined) { iv.departureDate = ''; changed = true; }
  });
  if (changed) saveDb();
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
  const allowedRoles = ['admin', 'member', 'contract_admin'];
  const userRole = allowedRoles.includes(role) ? role : 'member';
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

// 修改成员角色（仅管理员）。至少保留一个管理员，避免全员失去管理权限。
app.put('/api/users/:id/role', authMiddleware, adminOnly, (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const { role } = req.body;
  const allowedRoles = ['admin', 'member', 'contract_admin'];
  if (!allowedRoles.includes(role)) return res.status(400).json({ error: '无效的角色' });
  if (user.role === 'admin' && role !== 'admin') {
    const adminCount = db.users.filter(u => u.role === 'admin').length;
    if (adminCount <= 1) return res.status(400).json({ error: '至少保留一个管理员' });
  }
  user.role = role;
  saveDb();
  res.json({ ok: true, id: user.id, role: user.role });
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
  syncRecruitFromInterviews();
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
  syncRecruitFromInterviews();
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
  syncRecruitFromInterviews();
  res.json({ added, updated });
});

app.put('/api/interviews/:id', authMiddleware, (req, res) => {
  const idx = db.interviews.findIndex(iv => iv.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '面试记录不存在' });
  if (req.user.role !== 'admin' && db.interviews[idx].createdBy !== req.userId) {
    return res.status(403).json({ error: '无权修改他人记录' });
  }
  db.interviews[idx] = { ...db.interviews[idx], ...req.body };
  // 以面试记录为源头重算招聘进度 / 看板 / 新人随访
  syncRecruitFromInterviews();
  res.json(db.interviews[idx]);
});

app.delete('/api/interviews/:id', authMiddleware, (req, res) => {
  const iv = db.interviews.find(iv => iv.id === req.params.id);
  if (!iv) return res.status(404).json({ error: '面试记录不存在' });
  if (req.user.role !== 'admin' && iv.createdBy !== req.userId) {
    return res.status(403).json({ error: '无权删除他人记录' });
  }
  db.interviews = db.interviews.filter(iv => iv.id !== req.params.id);
  syncRecruitFromInterviews();
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
  syncRecruitFromInterviews();
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

// ========== 招聘联动：面试 → 招聘进度 / 招聘看板 / 新人随访 ==========
const SALES_POSITIONS = ['软件销售', '财税销售', '财税顾问'];
const DEPART_KEYWORDS = ['离职', '辞职', '自离', '劝退', '解聘', '离任', '开除'];

function hasOnboardDate(iv) {
  const d = (iv && iv.secondInterviewDate || '').toString().trim();
  return d !== '' && d !== '-' && d !== '待定' && d !== '无';
}
function hasDepartureDate(iv) {
  const d = (iv && iv.departureDate || '').toString().trim();
  return d !== '' && d !== '-';
}
function isOnboarded(iv) {
  // 有入职时间、未被淘汰、且未离职（填了离职时间或备注含离职关键词）→ 视为在岗
  return hasOnboardDate(iv) && (iv.result || '') !== '淘汰' && !isDeparted(iv);
}
function isDeparted(iv) {
  // 离职判定优先看「离职时间」字段；备注含离职关键词作为兜底兼容
  if (hasDepartureDate(iv)) return true;
  const notes = (iv && iv.notes || '').toString();
  return DEPART_KEYWORDS.some(k => notes.includes(k));
}
function weekOfMonth(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateStr || '').trim());
  if (!m) return 0;
  const day = parseInt(m[3], 10);
  if (!day) return 0;
  const wk = Math.ceil(day / 7);
  return wk >= 1 && wk <= 4 ? wk : (wk > 4 ? 4 : 0);
}
// ===== 随访模板/周期（按阶段匹配 + 存量自愈）=====
function cnDigitToNum(s) {
  const map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s === '十') return 10;
  if (map[s] !== undefined) return map[s];
  if (s.length > 2 && s.indexOf('十') === 1) return 10 + (map[s[2]] || 0); // 十一~十九
  if (s.length > 1 && s[0] === '十') return map[s[1]] ? 10 * map[s[1]] : 10; // 二十、三十…
  return 0;
}
// 周期名归一化为槽位：第1天→d1，第1周→w1，第2周→w2，第1/2/3个月→m1/m2/m3
function slotKeyOf(name) {
  const n = name || '';
  if (n.includes('天')) return 'd1';
  const m = /第?([0-9一二三四五六七八九十]+)\s*(周|个月|月)/.exec(n);
  if (!m) return '';
  const num = cnDigitToNum(m[1]);
  if (m[2].includes('周')) return num <= 1 ? 'w1' : (num === 2 ? 'w2' : 'w3');
  return num <= 1 ? 'm1' : (num === 2 ? 'm2' : 'm3');
}
// 按岗位匹配某阶段的访谈模板：岗位专属模板优先，其次全岗位通用模板
function templateForSlot(positionName, slotKw) {
  const posKw = positionName === '软件销售' ? ['软件销售', '销售新人']
    : positionName === '财税销售' ? ['财税销售', '销售新人']
    : [positionName];
  const pool = (db.templates || []).filter(t =>
    (t.name || '').includes(positionName) || posKw.some(k => (t.name || '').includes(k)));
  const exact = pool.find(t => (t.name || '').includes(slotKw));
  if (exact) return exact;
  // 全岗位通用模板兜底（如"新人第一天（全岗位）"）
  const generic = (db.templates || []).find(t => (t.name || '').includes(slotKw));
  if (generic) return generic;
  return pool[0] || null;
}
// 按岗位访谈模板生成第1天→第3个月的随访周期：6 个标准槽位，各槽位套用对应阶段的模板
function buildProbationPeriods(positionName) {
  const slots = [
    { name: '第1天', kw: '第一天' }, { name: '第1周', kw: '第一周' }, { name: '第2周', kw: '第二周' },
    { name: '第1个月', kw: '第一个月' }, { name: '第2个月', kw: '第二个月' }, { name: '第3个月', kw: '第三个月' }
  ];
  return slots.map(s => {
    const t = templateForSlot(positionName, s.kw);
    return { id: genId(), name: s.name, templateId: t ? t.id : '', questions: t ? [...(t.questions || [])] : [], checkins: [] };
  });
}
// 修复/补齐新人随访周期：保持 6 个标准槽位且带模板题，同时保留已有随访记录（按周期名槽位归位）
function healHirePeriods(h) {
  const desired = buildProbationPeriods(h.position || '');
  const byKey = {};
  (h.periods || []).forEach(p => { const k = slotKeyOf(p.name) || p.name; (byKey[k] = byKey[k] || []).push(p); });
  let changed = false;
  const merged = desired.map(slot => {
    const olds = byKey[slotKeyOf(slot.name)] || [];
    const old = olds.find(p => (p.checkins || []).length) || olds[0];
    if (!old) { changed = true; return slot; }
    let questions = old.questions || [];
    let templateId = old.templateId || '';
    if (!questions.length && slot.questions.length) { questions = slot.questions; templateId = slot.templateId; changed = true; }
    return { id: old.id || slot.id, name: slot.name, templateId, questions, checkins: old.checkins || [] };
  });
  // 6 槽之外的历史周期仅在有随访记录时保留（避免误删用户自建周期的随访数据）
  const extra = (h.periods || []).filter(p => {
    if (!(p.checkins || []).length) return false;
    const k = slotKeyOf(p.name);
    return !k || !desired.some(s => slotKeyOf(s.name) === k);
  });
  if (merged.length + extra.length !== (h.periods || []).length) changed = true;
  h.periods = merged.concat(extra);
  return changed;
}
function upsertFollowUp(iv) {
  const entryDate = iv.secondInterviewDate;
  const dept = (db.positions.find(p => p.position === iv.position) || {}).dept || '';
  // 归属人 = 面试管理的邀约人（inviter 为姓名文本）；邀约人为空时保留原归属/录入人
  const owner = (iv.inviter || '').toString().trim();
  const existing = db.hires.find(h => h.name === iv.name && h.position === iv.position);
  if (existing) {
    let changed = false;
    if (existing.entryDate !== entryDate) { existing.entryDate = entryDate; changed = true; }
    if (existing.createdBy !== iv.createdBy) { existing.createdBy = iv.createdBy; changed = true; }
    if (owner && existing.owner !== owner) { existing.owner = owner; changed = true; }
    if (!existing.dept && dept) { existing.dept = dept; changed = true; }
    if (healHirePeriods(existing)) changed = true;
    if (changed) saveDb();
    return;
  }
  db.hires.unshift({
    id: genId(), name: iv.name, position: iv.position, dept,
    entryDate, periods: buildProbationPeriods(iv.position),
    createdBy: iv.createdBy, owner, source: 'interview',
    createdAt: new Date().toISOString().split('T')[0]
  });
  saveDb();
}
function syncFollowUpFromInterviews() {
  // 1) 已离职人员（填了离职时间，或备注含离职关键词）→ 删除其新人随访记录
  const departedKeys = new Set();
  db.interviews.forEach(iv => {
    if (!iv.position || !iv.name) return;
    if (isDeparted(iv)) departedKeys.add(iv.name + '|' + iv.position);
  });
  if (departedKeys.size) {
    const before = db.hires.length;
    db.hires = db.hires.filter(h => !departedKeys.has(h.name + '|' + h.position));
    if (db.hires.length !== before) saveDb();
  }
  // 2) 销售岗（软件销售/财税销售/财税顾问）且已入职在岗 → 新建/更新随访并带出模板
  db.interviews.forEach(iv => {
    if (!iv.position) return;
    if (!SALES_POSITIONS.some(s => (iv.position || '').includes(s))) return;
    if (!isOnboarded(iv)) return;
    upsertFollowUp(iv);
  });
}
// 以面试记录为源头，重算招聘进度、招聘看板、新人随访
function syncRecruitFromInterviews() {
  const map = {};
  db.interviews.forEach(iv => {
    if (!iv.position) return;
    const o = map[iv.position] || (map[iv.position] = { week1: 0, week2: 0, week3: 0, week4: 0, attrition: 0, onboarded: 0 });
    // 曾入职但已离职（填了离职时间/备注含离职关键词）→ 计入流失并核减入职人数（不参与周次统计）
    if (isDeparted(iv) && hasOnboardDate(iv)) {
      o.attrition++;
    } else if (isOnboarded(iv)) {
      o.onboarded++;
      const wk = weekOfMonth(iv.secondInterviewDate);
      if (wk >= 1 && wk <= 4) o['week' + wk]++;
    }
  });
  // 仅对"有面试关联数据（有在岗或流失）"的岗位重算（完全无数据的岗位保留手动填写）
  db.progress.forEach(p => {
    const o = map[p.position];
    if (!o || (o.onboarded === 0 && o.attrition === 0)) return;
    p.week1 = o.week1; p.week2 = o.week2; p.week3 = o.week3; p.week4 = o.week4;
    p.attrition = o.attrition;
    p.totalEntry = p.week1 + p.week2 + p.week3 + p.week4;
    p.shortage = Math.max(0, (p.headcount || 0) - p.totalEntry);
    p.completion = p.headcount > 0 ? Math.round(p.totalEntry / p.headcount * 100) + '%' : '0%';
  });
  // 有面试关联数据（在岗或流失）但招聘进度表无该岗位行 → 自动补建
  Object.keys(map).forEach(pos => {
    const o = map[pos];
    if ((o.onboarded > 0 || o.attrition > 0) && !db.progress.find(p => p.position === pos)) {
      const posRow = db.positions.find(x => x.position === pos);
      const hc = posRow ? (posRow.headcount || 0) : 0;
      db.progress.push({
        id: genId(), position: pos, headcount: hc, priority: '中', urgency: '中', difficulty: '中',
        planNode: '', week1: o.week1, week2: o.week2, week3: o.week3, week4: o.week4,
        totalEntry: o.onboarded, shortage: Math.max(0, hc - o.onboarded),
        completion: hc > 0 ? Math.round(o.onboarded / hc * 100) + '%' : '0%',
        attrition: o.attrition, notes: '', createdBy: 'system', createdAt: new Date().toISOString().split('T')[0]
      });
    }
  });
  // 有入职人员但招聘看板无该岗位行 → 自动补建，保证看板同步
  Object.keys(map).forEach(pos => {
    const o = map[pos];
    if (o.onboarded > 0 && !db.positions.find(p => p.position === pos)) {
      db.positions.unshift({
        id: genId(), position: pos, dept: '',
        headcount: (db.progress.find(p => p.position === pos) || {}).headcount || 0,
        deadline: '',
        stages: { resumeScreen: 0, firstInterview: 0, secondInterview: 0, finalInterview: 0, offer: 0, onboard: o.onboarded },
        status: 'active', createdBy: 'system', createdAt: new Date().toISOString().split('T')[0]
      });
    }
  });
  // 同步招聘看板（岗位漏斗的已入职）
  db.positions.forEach(pos => {
    const o = map[pos.position] || { onboarded: 0 };
    pos.stages = pos.stages || {};
    pos.stages.onboard = o.onboarded || 0;
  });
  syncFollowUpFromInterviews();
  saveDb();
}

app.get('/api/hires', authMiddleware, (req, res) => {
  res.json(filterByUser(db.hires, req.userId, req.user.role));
});

app.post('/api/hires', authMiddleware, (req, res) => {
  const hire = {
    id: genId(), ...req.body,
    periods: req.body.periods || [],
    // 归属人：优先取前端传入(邀约人)；为空时回退当前登录成员姓名，便于手动建档也有归属
    owner: (req.body.owner || '').toString().trim() || (req.user.displayName || req.user.username || ''),
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
  // 以面试记录为源头，重算招聘进度 / 招聘看板 / 新人随访
  syncRecruitFromInterviews();
  res.json({ ok: true, count: db.progress.length });
});

// ========== 招聘看板历史归档（每月1号自动归档上月快照）==========
// 归档 = 把当月招聘看板各岗位漏斗(stages)快照存入 boardHistory[month]，只读回溯。
function monthStr(y, m) { return y + '-' + String(m).padStart(2, '0'); }
function prevMonthStr(d) {
  const date = d instanceof Date ? d : new Date();
  let y = date.getFullYear(), m = date.getMonth() + 1;
  m -= 1; if (m < 1) { m = 12; y -= 1; }
  return monthStr(y, m);
}
// 生成某岗位集的看板快照（仅保留展示与统计所需字段）
function boardSnapshotOf(list) {
  return (list || []).map(p => ({
    position: p.position, dept: p.dept || '', headcount: p.headcount || 0,
    deadline: p.deadline || '', status: p.status || 'active',
    stages: { resumeScreen: (p.stages && p.stages.resumeScreen) || 0, firstInterview: (p.stages && p.stages.firstInterview) || 0, secondInterview: (p.stages && p.stages.secondInterview) || 0, finalInterview: (p.stages && p.stages.finalInterview) || 0, offer: (p.stages && p.stages.offer) || 0, onboard: (p.stages && p.stages.onboard) || 0 }
  }));
}
// 归档指定月份(YYYY-MM)。幂等：同月已有记录则跳过不覆盖。
function archiveBoardSnapshot(month) {
  if (!month) return { archived: false, existed: false, month: null, reason: 'no-month' };
  if (!Array.isArray(db.boardHistory)) db.boardHistory = [];
  if (db.boardHistory.some(h => h.month === month)) return { archived: false, existed: true, month };
  db.boardHistory.unshift({
    id: genId(), month,
    archivedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    snapshot: boardSnapshotOf(db.positions)
  });
  saveDb();
  return { archived: true, existed: false, month, positions: db.positions.length };
}
// 每月1号启动时归档上个月的看板结果
function maybeAutoArchiveBoard() {
  const now = new Date();
  if (now.getDate() !== 1) return { auto: false, reason: 'not-1st', month: prevMonthStr(now) };
  const r = archiveBoardSnapshot(prevMonthStr(now));
  console.log(r.archived ? `boot: archived board snapshot for ${r.month}` : (r.existed ? `boot: board snapshot for ${r.month} already exists` : `boot: no board archive for ${r.month}`));
  return { auto: true, ...r };
}

app.get('/api/board-history', authMiddleware, (req, res) => {
  res.json((db.boardHistory || []).map(h => ({
    id: h.id, month: h.month, archivedAt: h.archivedAt, positionCount: (h.snapshot || []).length,
    snapshot: h.snapshot || []
  })));
});
app.post('/api/board-history/archive', authMiddleware, adminOnly, (req, res) => {
  // 手动归档指定月份；不传 month 默认归档上月
  const month = (req.body && req.body.month) || prevMonthStr(new Date());
  const r = archiveBoardSnapshot(month);
  if (!r.archived && !r.existed) return res.status(400).json({ error: '归档失败：' + (r.reason || '未知原因') });
  res.json(r);
});
app.delete('/api/board-history/:month', authMiddleware, adminOnly, (req, res) => {
  // 删除某月归档（便于修正后重新归档）
  const before = (db.boardHistory || []).length;
  db.boardHistory = (db.boardHistory || []).filter(h => h.month !== req.params.month);
  if (db.boardHistory.length === before) return res.status(404).json({ error: '该月份无归档记录' });
  saveDb();
  res.json({ ok: true, removed: req.params.month });
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
  
  // Migrate AI recruitment collections
  if (Array.isArray(data.jobSpecs)) {
    data.jobSpecs.forEach(j => { db.jobSpecs.unshift({ ...j, id: genId(), createdBy: req.userId, createdAt: now }); count++; });
  }
  if (Array.isArray(data.candidates)) {
    data.candidates.forEach(c => { db.candidates.unshift({ ...c, id: genId(), createdBy: req.userId, createdAt: now }); count++; });
  }
  if (Array.isArray(data.questionBanks)) {
    data.questionBanks.forEach(q => { db.questionBanks.unshift({ ...q, id: genId(), createdBy: req.userId, createdAt: now }); count++; });
  }
  if (Array.isArray(data.hiringDecisions)) {
    data.hiringDecisions.forEach(h => { db.hiringDecisions.unshift({ ...h, id: genId(), createdBy: req.userId, createdAt: now }); count++; });
  }
  if (Array.isArray(data.probations)) {
    data.probations.forEach(p => { db.probations.unshift({ ...p, id: genId(), createdBy: req.userId, createdAt: now }); count++; });
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
    jobSpecs: db.jobSpecs,
    candidates: db.candidates,
    questionBanks: db.questionBanks,
    hiringDecisions: db.hiringDecisions,
    probations: db.probations,
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
  if (data.jobSpecs) { db.jobSpecs = data.jobSpecs; count += data.jobSpecs.length; }
  if (data.candidates) { db.candidates = data.candidates; count += data.candidates.length; }
  if (data.questionBanks) { db.questionBanks = data.questionBanks; count += data.questionBanks.length; }
  if (data.hiringDecisions) { db.hiringDecisions = data.hiringDecisions; count += data.hiringDecisions.length; }
  if (data.probations) { db.probations = data.probations; count += data.probations.length; }
  saveDb();
  res.json({ count });
});

// ========== SPA fallback (registered LAST so it never shadows API routes) ==========
// NOTE: this is intentionally placed after all /api routes. It is defined again below
// right before app.listen. Do not re-add a wildcard here.

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
    // 统一清理已废弃的 expectedOnboardDate（值不迁到 departureDate，见 ensureDefaultUsers 注释）
    if (iv.expectedOnboardDate !== undefined) { delete iv.expectedOnboardDate; migrated = true; }
    iv.departureDate = iv.departureDate || '';
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

// ========== AI Recruitment Assistant ==========
// Pluggable AI provider: uses OpenAI-compatible endpoint if AI_BASE_URL/AI_API_KEY/AI_MODEL
// are set; otherwise falls back to the free Doubao endpoint via DOUBAO_SESSIONID; otherwise
// returns a friendly AI_NOT_CONFIGURED error (no crash).
async function callAI(systemPrompt, userPrompt) {
  const fallback = (process.env.DOUBAO_SESSIONID || '').trim() ? (process.env.DOUBAO_BASE_URL || '') : '';
  let base = (process.env.AI_BASE_URL || fallback).trim();
  if (!base) {
    const err = new Error('AI 未配置：请设置 AI_BASE_URL/AI_API_KEY/AI_MODEL（推荐火山方舟：https://ark.cn-beijing.volces.com/api/v3）');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }
  // 容错：允许只填到 /v1 或 /api/v3，自动补全 /chat/completions；同时去掉粘贴时混入的换行/空格
  base = base.replace(/[\s\/]+$/, '');
  if (!base.endsWith('/chat/completions')) base = base + '/chat/completions';
  const apiKey = (process.env.AI_API_KEY || process.env.DOUBAO_SESSIONID || '').trim();
  const model = (process.env.AI_MODEL || '').trim() || (process.env.DOUBAO_SESSIONID ? 'doubao' : 'gpt-4o-mini');
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    stream: false
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const r = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    const j = await r.json().catch(() => ({}));
    if (j.error) throw new Error(typeof j.error === 'string' ? j.error : j.error.message || 'AI 接口错误');
    const content = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
    if (!content) throw new Error('AI 返回内容为空');
    return content;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('AI 调用超时（120秒）');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Extract JSON from AI text (handles code fences / prose wrapping)
function extractJson(text) {
  if (typeof text !== 'string') return text;
  // 去除 BOM 与零宽字符，避免 AI 输出偶发“乱码”
  text = text.replace(/[﻿\uFEFF\u200B\u200C\u200D]/g, '').trim();
  try { return JSON.parse(text); } catch (e) {}
  // strip code fences
  let t = text.replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(t); } catch (e) {}
  const obj = t.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch (e) {} }
  const arr = t.match(/\[[\s\S]*\]/);
  if (arr) { try { return JSON.parse(arr[0]); } catch (e) {} }
  throw new Error('AI 返回内容无法解析为 JSON');
}

async function aiJson(res, systemPrompt, userPrompt) {
  try {
    const text = await callAI(systemPrompt, userPrompt);
    res.json(extractJson(text));
  } catch (e) {
    if (e.code === 'AI_NOT_CONFIGURED') return res.status(400).json({ error: e.message });
    console.error('[AI/json]', e.message);
    res.status(500).json({ error: 'AI 调用失败：' + e.message });
  }
}

// Generic chat
app.post('/api/ai/chat', authMiddleware, async (req, res) => {
  try {
    const text = await callAI(req.body.system || '你是一个专业的 HR 招聘助手。', req.body.prompt || '');
    res.json({ text });
  } catch (e) {
    if (e.code === 'AI_NOT_CONFIGURED') return res.status(400).json({ error: e.message });
    console.error('[AI/chat]', e.message);
    res.status(500).json({ error: 'AI 调用失败：' + e.message });
  }
});

// Diagnostic endpoint: tests AI provider without auth, returns detailed error (no secrets leaked)
app.get('/api/ai/diag', async (req, res) => {
  const cfg = {
    AI_BASE_URL: process.env.AI_BASE_URL || '',
    AI_API_KEY_PREFIX: (process.env.AI_API_KEY || '').slice(0, 12) + '...',
    AI_MODEL: process.env.AI_MODEL || '',
    DOUBAO_BASE_URL: process.env.DOUBAO_BASE_URL || '',
    DOUBAO_SESSIONID_PREFIX: (process.env.DOUBAO_SESSIONID || '').slice(0, 12) + '...'
  };
  try {
    const text = await callAI('You are a helpful assistant. Reply exactly one word: OK', 'Say OK');
    res.json({ ok: true, config: cfg, response: text.slice(0, 200) });
  } catch (e) {
    console.error('[AI/diag]', e.message);
    res.status(500).json({ ok: false, config: cfg, error: e.message });
  }
});

// 1. JD + 胜任力 一体化生成（岗位简章排版：名称/部门/层级 + 职责序号 + 要求序号；胜任力按精通→了解 由主到次）
app.post('/api/ai/jd', authMiddleware, (req, res) => {
  const { position, dept, level, responsibilities, requirements } = req.body;
  const system = `你是资深 HR 专家，擅长撰写规范、合规的岗位说明书（JD）与胜任力模型。基于用户输入一次性生成结构化结果，必须只输出 JSON（不要任何额外说明文字）：
{
  "position":"岗位名称",
  "dept":"所属部门",
  "level":"岗位层级",
  "duties":["岗位职责1","岗位职责2","..."],
  "requirements":["任职要求1","任职要求2","..."],
  "competencies":[
    {"category":"精通","items":[{"name":"能力项","involve":"主要","desc":"说明"}]},
    {"category":"熟练","items":[{"name":"能力项","involve":"负责","desc":"说明"}]},
    {"category":"熟悉","items":[{"name":"能力项","involve":"协助","desc":"说明"}]},
    {"category":"了解","items":[{"name":"能力项","involve":"参与","desc":"说明"}]}
  ],
  "complianceNotes":"合规风险提示与修改建议"
}
要求：
1. duties 与 requirements 均为短语列表，每项为一句简洁短语，不要包含序号、项目符号、换行或乱码字符（序号由系统自动生成），按重要性由主到次排序。
2. competencies 按掌握程度从"精通"到"了解"由主到次排列；每个能力项用 involve 标注责任强度（主要/负责/协助/参与）。如某层级无内容则给空数组。
3. 如用户未提供部门或层级，依据岗位常识合理推断，不要留空。
4. 合规提示须指出是否存在年龄/性别/地域等就业歧视措辞并给出修改建议。`;
  const user = `岗位名称：${position||''}\n部门：${dept||''}\n层级：${level||''}\n核心职责：${responsibilities||''}\n任职要求：${requirements||''}\n请生成岗位简章（duties/requirements）与胜任力模型（competencies）。`;
  aiJson(res, system, user);
});

// 2. Competency decomposition
app.post('/api/ai/competency', authMiddleware, (req, res) => {
  const { position, dept, level, responsibilities } = req.body;
  const system = '你是招聘测评专家。将岗位要求拆解为三大类：硬技能、软技能、职业素养。输出 JSON：{"dimensions":[{"name":"硬技能|软技能|职业素养","weight":0-100,"items":[{"name":"...","desc":"..."}]}]}，三类 weight 之和=100。';
  const user = `岗位：${position||''}\n部门：${dept||''}\n层级：${level||''}\n职责：${responsibilities||''}\n请给出胜任力维度与权重拆解。`;
  aiJson(res, system, user);
});

// 3. Resume parsing -> talent registry
app.post('/api/ai/parse-resume', authMiddleware, (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: '请粘贴简历文本' });
  const system = `你是简历解析引擎。将简历文本解析为标准《人才登记表》结构化字段，必须只输出 JSON（不要额外说明）：
{"basic":{"name":"","gender":"","age":null,"maritalStatus":"","applyPosition":"","currentLocation":"","expectedLocation":"","phone":"","currentSalary":"","expectedSalary":""},
"education":[{"school":"","major":"","degree":"","gradDate":""}],
"work":[{"company":"","position":"","startDate":"","endDate":"","leaveReason":""}],
"skills":["..."],
"certificates":["..."]}
解析规则：
1. name：简历姓名。
2. gender：有明示性别则填；无则根据姓名常见用字推断（伟/强/磊/杰/勇/峰多男，芳/丽/娟/婷/燕/敏多女），无把握则填空字符串。
3. age：优先取简历直接年龄；无则据出生年月或毕业年份推算当前年龄；都没有则填 null。
4. maritalStatus：据“已婚/未婚/已育”等字样填入，没有则填空。
5. applyPosition：简历求职意向/应聘岗位；currentLocation：现居住地；expectedLocation：期望工作地。
6. phone：从简历识别 11 位手机号填入，没有则填空。
7. currentSalary / expectedSalary：据简历正文薪资描述填入（不要从文件名推断），没有则填空。
8. education / work：按简历原文分段提取，时间倒序。
9. skills / certificates：据简历据实提取。`;
  aiJson(res, system, '请解析以下简历：\n' + text);
});

// 3.1 简历文件文本提取（支持 txt/md/pdf/docx/jpg/png）
app.post('/api/ai/extract-resume', authMiddleware, async (req, res) => {
  try {
    const { fileName, data, mime } = req.body || {};
    if (!data) return res.status(400).json({ error: '未收到文件内容' });
    const buf = Buffer.from(String(data), 'base64');
    const lower = (fileName || '').toLowerCase();
    const m = (mime || '').toLowerCase();
    let text = '';
    if (lower.endsWith('.pdf') || m.includes('pdf')) {
      const pdfParse = require('pdf-parse');
      const out = await pdfParse(buf);
      text = out.text || '';
    } else if (lower.endsWith('.docx') || m.includes('word') || m.includes('officedocument')) {
      const mammoth = require('mammoth');
      const out = await mammoth.extractRawText({ buffer: buf });
      text = out.value || '';
    } else if (lower.endsWith('.txt') || lower.endsWith('.md') || m.includes('text/plain') || m.includes('text/markdown')) {
      text = buf.toString('utf8');
    } else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || m.includes('image/')) {
      try {
        const Tesseract = require('tesseract.js');
        const result = await Tesseract.recognize(buf, 'chi_sim+eng', { logger: () => {} });
        text = (result.data && result.data.text) || '';
      } catch (e) {
        return res.status(422).json({ error: '图片文字识别(OCR)失败：' + e.message + '。建议改用 PDF / Word 文档上传。' });
      }
    } else {
      text = buf.toString('utf8');
    }
    text = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
    if (!text) return res.status(422).json({ error: '未能从文件中提取到文本，请确认文件未加密或换用 PDF/Word。' });
    res.json({ text });
  } catch (e) {
    console.error('[extract-resume]', e.message);
    res.status(500).json({ error: '文件解析失败：' + e.message });
  }
});

// 4. Candidate-job matching score
app.post('/api/ai/match', authMiddleware, (req, res) => {
  const { jobSpec, candidate } = req.body;
  const system = '你是招聘匹配评估专家。基于岗位胜任力标准评估候选人。输出 JSON：{"score":0-100,"matched":["匹配项..."],"gaps":["短板项..."],"summary":"综合评语"}。';
  const user = `岗位标准：${JSON.stringify(jobSpec||{})}\n候选人信息：${JSON.stringify(candidate||{})}\n请给出 0-100 匹配度评分。`;
  aiJson(res, system, user);
});

// 5. Resume anomaly check
app.post('/api/ai/anomaly', authMiddleware, (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: '请提供简历文本或解析结果' });
  const system = '你是简历背景调查专家。排查简历疑点。输出 JSON：{"issues":[{"type":"时间断层|经历重叠|年龄学历不符|频繁跳槽|薪资异常","desc":"...","severity":"高|中|低"}]}。';
  aiJson(res, system, '请核查以下简历：\n' + text);
});

// 6. Interview question bank generation
app.post('/api/ai/questions', authMiddleware, (req, res) => {
  const { position, competencies, candidateBackground, resumeText } = req.body;
  const system = `你是面试命题专家。基于【岗位核心要求】与【候选人简历】生成专属题本，必须只输出 JSON（不要额外说明）：
{"questions":[
  {"category":"专业能力","question":"...","points":"考察要点","scoreStd":"0-10分评分标准","followUp":"参考追问"},
  {"category":"专业能力","question":"...","points":"...","scoreStd":"...","followUp":"..."},
  {"category":"专业能力","question":"...","points":"...","scoreStd":"...","followUp":"..."},
  {"category":"行为事件","question":"...","points":"...","scoreStd":"...","followUp":"..."},
  {"category":"行为事件","question":"...","points":"...","scoreStd":"...","followUp":"..."},
  {"category":"情景模拟","question":"...","points":"...","scoreStd":"...","followUp":"..."},
  {"category":"情景模拟","question":"...","points":"...","scoreStd":"...","followUp":"..."},
  {"category":"简历追问","question":"...","points":"...","scoreStd":"...","followUp":"..."},
  {"category":"简历追问","question":"...","points":"...","scoreStd":"...","followUp":"..."}
]}
题量要求：专业能力 3 题、行为事件 2 题（据简历项目经历命制）、情景模拟 2 题（据公司该岗位核心要求命制）、简历追问 2 题（针对简历疑点/空白），合计 9 题。每题含 question/points/scoreStd/followUp。`;
  const user = `岗位：${position||''}\n胜任力标准：${JSON.stringify(competencies||{})}\n候选人简历背景：${candidateBackground||''}\n候选人简历原文：${resumeText||''}\n请按上述分类与题量生成专属题本。`;
  aiJson(res, system, user);
});

// 7. Hiring decision report
app.post('/api/ai/decision', authMiddleware, (req, res) => {
  const { candidate, matchResult, interviewScores } = req.body;
  const system = '你是录用决策专家。整合信息生成综合评估报告。输出 JSON：{"strengths":["..."],"risks":["..."],"salarySuggestion":{"range":"...","notes":"..."},"recommendation":"建议录用|建议储备|不建议录用","summary":"综合评语"}。';
  const user = `候选人：${JSON.stringify(candidate||{})}\n匹配结果：${JSON.stringify(matchResult||{})}\n面试评分：${JSON.stringify(interviewScores||{})}\n请给出录用决策建议。`;
  aiJson(res, system, user);
});

// 8. Probation plan
app.post('/api/ai/probation', authMiddleware, (req, res) => {
  const { position, competencies, candidateResume, interviewFeedback } = req.body;
  const system = `你是试用期管理专家。基于【岗位胜任力】+【候选人简历】+【面试结果反馈】为该候选人生成个性化试用期考察目标，必须只输出 JSON（不要额外说明）：
{"goals":[
  {"phase":"第一周","objective":"...","kpi":"可量化指标","evalPoints":"评估要点"},
  {"phase":"第二周","objective":"...","kpi":"...","evalPoints":"..."},
  {"phase":"第一个月","objective":"...","kpi":"...","evalPoints":"..."},
  {"phase":"第二个月","objective":"...","kpi":"...","evalPoints":"..."},
  {"phase":"第三个月","objective":"...","kpi":"...","evalPoints":"..."}
],
"evalTemplate":"试用期评估要点与评分维度说明（含定量与定性）",
"decisionAdvice":"结合优劣势的转正/延长/不转正的定量与定性判定逻辑"}
要求：
1. goals 必须包含 5 个阶段：第一周、第二周、第一个月、第二个月、第三个月。
2. 目标须结合候选人简历优劣势与该岗位核心要求，体现个性化。
3. evalPoints 与 decisionAdvice 须同时包含定量（可量化指标/分数）与定性（行为/能力描述）标准。`;
  const user = `岗位：${position||''}\n岗位核心要求：${JSON.stringify(competencies||{})}\n候选人简历：${JSON.stringify(candidateResume||{})}\n面试结果反馈：${interviewFeedback||''}\n请生成个性化试用期目标。`;
  aiJson(res, system, user);
});

// ========== Generic CRUD factory for new collections ==========
function addCrud(collection) {
  const cap = collection;
  app.get(`/api/${cap}`, authMiddleware, (req, res) => {
    res.json(filterByUser(db[cap], req.userId, req.user.role));
  });
  app.post(`/api/${cap}`, authMiddleware, async (req, res) => {
    const item = {
      id: genId(), ...req.body,
      createdBy: req.userId,
      createdAt: new Date().toISOString().split('T')[0]
    };
    db[cap].unshift(item);
    try { await saveDb(); } catch (e) { return res.status(500).json({ error: '保存失败：' + e.message }); }
    res.json(item);
  });
  app.put(`/api/${cap}/:id`, authMiddleware, async (req, res) => {
    const idx = db[cap].findIndex(x => x.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: '记录不存在' });
    if (req.user.role !== 'admin' && db[cap][idx].createdBy !== req.userId) {
      return res.status(403).json({ error: '无权修改他人记录' });
    }
    db[cap][idx] = { ...db[cap][idx], ...req.body };
    try { await saveDb(); } catch (e) { return res.status(500).json({ error: '保存失败：' + e.message }); }
    res.json(db[cap][idx]);
  });
  app.delete(`/api/${cap}/:id`, authMiddleware, async (req, res) => {
    const idx = db[cap].findIndex(x => x.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: '记录不存在' });
    if (req.user.role !== 'admin' && db[cap][idx].createdBy !== req.userId) {
      return res.status(403).json({ error: '无权删除他人记录' });
    }
    db[cap].splice(idx, 1);
    try { await saveDb(); } catch (e) { return res.status(500).json({ error: '删除失败：' + e.message }); }
    res.json({ ok: true });
  });
}
addCrud('jobSpecs');
addCrud('candidates');
addCrud('questionBanks');
addCrud('hiringDecisions');
addCrud('probations');

// ========== Health endpoint (register BEFORE the SPA fallback so the wildcard never shadows it) ==========
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now(), store: usePg ? 'postgres' : 'file', dbUrlSet: !!process.env.DATABASE_URL, pgError: lastPgError, interviews: db.interviews.length, positions: db.positions.length });
});

// ========== SPA fallback (must be LAST so it never shadows /api routes) ==========
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== Start ==========
(async () => {
  await initStore();
  if (!db.contracts) db.contracts = [];
  // Ensure newly-added collections exist even when loading an older db.json
  ['jobSpecs', 'candidates', 'questionBanks', 'hiringDecisions', 'probations', 'boardHistory'].forEach(k => { if (!db[k]) db[k] = []; });
  // Seed a demo job spec once (so the module is usable immediately on existing DBs)
  if (db.jobSpecs.length === 0) {
    const now = new Date().toISOString().split('T')[0];
    db.jobSpecs.push({
      id: genId(), position: 'HRBP', dept: '人力资源部', level: '中级',
      responsibilities: '负责业务部门的HR伙伴工作，包含招聘、员工关系、组织氛围建设',
      jd: 'HRBP 岗位说明书（示例）：负责对接业务部门，提供人力资源解决方案，推动人才梯队建设，优化组织效能。',
      competencies: [
        { name: '硬技能', weight: 40, items: [{ name: '劳动法合规', desc: '熟悉劳动合同法及用工风险' }, { name: '数据分析', desc: '能用数据驱动HR决策' }] },
        { name: '软技能', weight: 35, items: [{ name: '沟通协调', desc: '跨部门高效沟通' }, { name: '影响力', desc: '推动业务负责人行动' }] },
        { name: '职业素养', weight: 25, items: [{ name: '保密意识', desc: '严守薪酬与人事信息保密' }, { name: '责任心', desc: '对结果负责' }] }
      ],
      createdBy: db.users[0] ? db.users[0].id : 'system', createdAt: now
    });
    saveDb();
  }
  migrateHires();
  migrateInterviews();
  migrateTemplates();
  seedDb();
  ensureDefaultUsers();
  // 新版本首次启动自愈：按面试记录重算一次招聘联动（修复存量销售岗随访周期并带出模板题、
  // 清理填了离职时间/备注含离职关键词人员的随访记录、核减招聘进度与看板人数）。
  // 之后由面试记录的增/改/删及"从面试同步"按钮持续驱动。
  if (!bootFreshSeed && !db._recruitAutoSyncOnce) {
    try {
      syncRecruitFromInterviews();
      db._recruitAutoSyncOnce = true;
      await saveDb();
      console.log('boot: recruit-linkage auto-sync done (heal follow-ups / attrition)');
    } catch (e) { console.error('boot: recruit-linkage auto-sync error:', e.message); }
  }
  // 归属人回填：新版本上线后，把存量销售岗随访的 owner 补齐为面试邀约人（只跑一次）
  if (!bootFreshSeed && !db._ownerAutoSyncDone) {
    try {
      syncFollowUpFromInterviews();
      db._ownerAutoSyncDone = true;
      await saveDb();
      console.log('boot: follow-up owner backfill done (owner = interview inviter)');
    } catch (e) { console.error('boot: follow-up owner backfill error:', e.message); }
  }
  // 每月1号启动时自动归档上个月的招聘看板快照（幂等，不影响既有归档）
  try { maybeAutoArchiveBoard(); } catch (e) { console.error('boot: board auto-archive error:', e.message); }
  // 若本次从文件存储迁移了数据到 Postgres，立即落库，确保不丢失
  if (migratedFromFile) {
    try { await saveDb(); console.log('Migrated existing file data into Postgres (persisted)'); }
    catch (e) { console.error('Migration persist error:', e.message); }
  }

  // 输出文档 .docx 导出（规范：人才登记表/题本/评估报告/录用建议 等）
  app.post('/api/ai/export-docx', authMiddleware, async (req, res) => {
    try {
      const { type, data } = req.body || {};
      if (!type || !data) return res.status(400).json({ error: '缺少 type 或 data' });
      const document = docxExport.buildDocx(type, data);
      const buf = await docxExport.toBuffer(document);
      const names = { talentRegister: '人才登记表', questionBank: '面试题本', evalReport: '评估报告', hireProposal: '录用建议', probationPlan: '试用期方案', jobSpec: '岗位说明书' };
      const base = (names[type] || '文档') + '_' + (data.name || data.candidateName || data.title || 'export');
      const enc = encodeURIComponent(base + '.docx');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="export.docx"; filename*=UTF-8''${enc}`);
      res.send(buf);
    } catch (e) {
      console.error('[export-docx]', e.message);
      res.status(500).json({ error: '生成文档失败：' + e.message });
    }
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
