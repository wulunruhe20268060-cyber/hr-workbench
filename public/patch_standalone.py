import re

with open('F:/workbuddy/hr-team/public/standalone.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Phase 2: Replace auth/login/API system with localStorage data layer
old_block_start = 'let auth = { token:'
old_block_end = 'function switchTab'

start = html.find(old_block_start)
end = html.find(old_block_end, start)

if start < 0 or end < 0:
    print(f'ERROR: Could not find blocks: start={start}, end={end}')
    exit(1)

print(f'Replacing from position {start} to {end}')

new_block = '''let auth = { userId: 'local', username: 'local', displayName: '本地用户', role: 'admin' };
const STORAGE_PREFIX = 'wb_hr_standalone_';

function isAdmin() { return true; }

// ==================== LocalStorage Data Layer ====================
function ldGet(key) {
  try { const raw = localStorage.getItem(STORAGE_PREFIX + key); return raw ? JSON.parse(raw) : null; }
  catch(e) { console.error('ldGet error:', e); return null; }
}
function ldSet(key, data) {
  try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data)); }
  catch(e) { console.error('ldSet error:', e); showToast('存储空间不足，请清理数据'); }
}
function ldGetPositions() { return ldGet('positions') || []; }
function ldGetInterviews() { return ldGet('interviews') || []; }
function ldGetTodos() { return ldGet('todos') || []; }
function ldGetTemplates() { return ldGet('templates') || []; }
function ldGetHires() { return ldGet('hires') || []; }
function ldGetProgress() { return ldGet('progress') || []; }

function genId() { return 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9); }

// Seed data if empty
function seedLocalData() {
  const now = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now()-86400000).toISOString().split('T')[0];
  const fut7 = new Date(Date.now()+7*86400000).toISOString().split('T')[0];
  
  if (!ldGet('templates')) ldSet('templates', [
    { id: genId(), name: '入职1周访谈', questions: ['入职培训是否完成？','对团队氛围的适应情况如何？','目前遇到的困难有哪些？','对带教有什么建议？'], createdBy: 'local', createdAt: now },
    { id: genId(), name: '入职1个月访谈', questions: ['目前工作上手程度如何？','和上级沟通顺畅吗？','公司文化适应得怎么样？','对培训有什么建议？','近期职业发展期望？'], createdBy: 'local', createdAt: now }
  ]);
  
  if (!ldGet('positions')) ldSet('positions', [
    { id: genId(), position: '高级前端工程师', dept: '技术部', headcount: 2, deadline: fut7, stages: { resumeScreen: 12, firstInterview: 5, secondInterview: 3, finalInterview: 1, offer: 0, onboard: 0 }, status: 'active', createdBy: 'local', createdAt: yesterday },
    { id: genId(), position: 'HRBP', dept: '人力资源部', headcount: 1, deadline: fut7, stages: { resumeScreen: 8, firstInterview: 4, secondInterview: 2, finalInterview: 1, offer: 1, onboard: 0 }, status: 'active', createdBy: 'local', createdAt: yesterday },
    { id: genId(), position: '市场运营经理', dept: '市场部', headcount: 1, deadline: yesterday, stages: { resumeScreen: 15, firstInterview: 6, secondInterview: 3, finalInterview: 2, offer: 0, onboard: 0 }, status: 'active', createdBy: 'local', createdAt: '2026-07-15' }
  ]);
  
  if (!ldGet('interviews')) ldSet('interviews', [
    { id: genId(), name: '李明', position: '高级前端工程师', phone: '13812345678', education: '本科', gender: '男', inviter: '张主管', source: 'BOSS直聘', firstInterviewDate: now, secondInterviewDate: '', interviewer: '张主管', result: '待面试', expectedOnboardDate: '', notes: '5年React经验，有大厂背景', createdBy: 'local', createdAt: yesterday },
    { id: genId(), name: '王芳', position: 'HRBP', phone: '13987654321', education: '硕士', gender: '女', inviter: '李总监', source: '猎头推荐', firstInterviewDate: yesterday, secondInterviewDate: '', interviewer: '李总监', result: '通过', expectedOnboardDate: '2026-08-15', notes: '沟通能力强，6年HR经验', createdBy: 'local', createdAt: '2026-07-28' },
    { id: genId(), name: '赵雪', position: '高级前端工程师', phone: '13733334444', education: '大专', gender: '女', inviter: '张主管', source: '拉勾', firstInterviewDate: yesterday, secondInterviewDate: '', interviewer: '张主管', result: '淘汰', expectedOnboardDate: '', notes: '技术基础偏弱', createdBy: 'local', createdAt: yesterday }
  ]);
  
  if (!ldGet('todos')) ldSet('todos', [
    { id: genId(), title: '确认王芳的Offer薪资方案', frequency: '日', priority: 'P0', dueDate: yesterday, completed: false, createdBy: 'local', createdAt: yesterday },
    { id: genId(), title: '整理本周面试通过人员汇总', frequency: '周', priority: 'P1', dueDate: now, completed: false, createdBy: 'local', createdAt: yesterday },
    { id: genId(), title: '与张主管对齐前端岗位面试标准', frequency: '日', priority: 'P1', dueDate: now, completed: true, createdBy: 'local', createdAt: yesterday }
  ]);
  
  if (!ldGet('progress')) ldSet('progress', [
    { id: genId(), position: '高级前端工程师', headcount: 2, priority: '高', urgency: '高', difficulty: '中', milestone: '8月15日前到岗1人', week1: 1, week2: 0, week3: 0, week4: 0, totalEntry: 1, shortage: 1, completion: '50%', note: 'BOSS直聘渠道为主', createdBy: 'local', createdAt: now },
    { id: genId(), position: 'HRBP', headcount: 1, priority: '中', urgency: '中', difficulty: '中', milestone: '8月20日前到岗', week1: 0, week2: 0, week3: 0, week4: 0, totalEntry: 0, shortage: 1, completion: '0%', note: '', createdBy: 'local', createdAt: now },
    { id: genId(), position: '市场运营经理', headcount: 1, priority: '高', urgency: '高', difficulty: '高', milestone: '', week1: 0, week2: 0, week3: 0, week4: 0, totalEntry: 0, shortage: 1, completion: '0%', note: '需与王总确认JD', createdBy: 'local', createdAt: now }
  ]);
  
  if (!ldGet('hires')) ldSet('hires', [
    { id: genId(), name: '陈静', position: 'HRBP', dept: '人力资源部', entryDate: '2026-07-15', periods: [{ id: genId(), name: '第1周', templateId: '', questions: ['岗位职责是否清晰？','团队融入情况如何？','对公司文化第一印象？'], checkins: [{ date: '2026-07-22', answers: {'0':'职责清晰，上手较快','1':'团队氛围好，同事们很帮忙','2':'公司文化比较开放，沟通顺畅'}, feedback: '整体适应良好', notes: '' }] }], createdBy: 'local', createdAt: '2026-07-15' },
    { id: genId(), name: '刘洋', position: '市场运营', dept: '市场部', entryDate: '2026-07-25', periods: [{ id: genId(), name: '第1周', templateId: '', questions: ['工作内容是否与预期一致？','和导师沟通频率如何？'], checkins: [], createdBy: 'local', createdAt: '2026-07-25' }], createdBy: 'local', createdAt: '2026-07-25' }
  ]);
}

seedLocalData();

// ==================== Navigation ====================
'''

html = html[:start] + new_block + html[end:]

# Phase 3: Fix render() to load from localStorage instead of API
html = html.replace(
    "async function render() {",
    "async function render() {\n  seedLocalData(); // ensure data exists\n"
)

# Replace all apiGet('/api/xxx') with localStorage calls
replacements = [
    ("await apiGet('/api/positions')", "ldGetPositions()"),
    ("await apiGet('/api/interviews')", "ldGetInterviews()"),
    ("await apiGet('/api/todos')", "ldGetTodos()"),
    ("await apiGet('/api/templates')", "ldGetTemplates()"),
    ("await apiGet('/api/hires')", "ldGetHires()"),
    ("await apiGet('/api/progress')", "ldGetProgress()"),
]

for old, new in replacements:
    html = html.replace(old, new)

# Fix apiPost calls for save operations - we need to handle each case
# We'll add helper wrappers below

# Remove team management function and checkLocalStorageMigration
html = re.sub(r'async function showTeamManage\(\)[\s\S]*?// ==================== Today Overview', '// ==================== Today Overview', html)
html = re.sub(r'async function checkLocalStorageMigration\(\)[\s\S]*?}\n}', 'function exportData() {\n  const data = { positions: ldGetPositions(), interviews: ldGetInterviews(), todos: ldGetTodos(), templates: ldGetTemplates(), hires: ldGetHires(), progress: ldGetProgress() };\n  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });\n  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "hr-backup-" + new Date().toISOString().slice(0,10) + ".json"; a.click();\n  showToast("数据已导出");\n}\nasync function importData(event) {\n  const file = event.target.files[0]; if (!file) return;\n  try {\n    const text = await file.text();\n    const data = JSON.parse(text);\n    if (data.positions) ldSet("positions", data.positions);\n    if (data.interviews) ldSet("interviews", data.interviews);\n    if (data.todos) ldSet("todos", data.todos);\n    if (data.templates) ldSet("templates", data.templates);\n    if (data.hires) ldSet("hires", data.hires);\n    if (data.progress) ldSet("progress", data.progress);\n    await render(); showToast("数据已恢复");\n    event.target.value = "";\n  } catch(e) { showToast("文件格式错误"); event.target.value = ""; }\n}', html)

# Remove doLogin, doLogout, showLogin, updateHeader, showTeamManage
html = re.sub(r'async function doLogin\(\)[\s\S]*?function showLogin\(\)[\s\S]*?document\.getElementById\(\'mainApp\'\)\.style\.display = \'none\';\n}', '', html)
html = re.sub(r'function updateHeader\(\)[\s\S]*?}\n}', '', html)
html = re.sub(r'async function doLogout\(\)[\s\S]*?}\n}', '', html)

# Remove mobileTabs event listener (already handled by switchTab)
html = re.sub(r"document\.getElementById\('mobileTabs'\)\.addEventListener[\s\S]*?\n}\);?\n?", '', html)

# Fix today overview to use localStorage
html = html.replace(
    "const [positions, interviews, todos, hires] = await Promise.all([\n      apiGet('/api/positions'),\n      apiGet('/api/interviews'),\n      apiGet('/api/todos'),\n      apiGet('/api/hires')\n    ]);",
    "const positions = ldGetPositions();\n    const interviews = ldGetInterviews();\n    const todos = ldGetTodos();\n    const hires = ldGetHires();"
)

# Fix render() data loading
html = html.replace(
    "const [positions, interviews, todos, templates, hires, progress] = await Promise.all([\n    apiGet('/api/positions'),\n    apiGet('/api/interviews'),\n    apiGet('/api/todos'),\n    apiGet('/api/templates'),\n    apiGet('/api/hires'),\n    apiGet('/api/progress')\n  ]);",
    "const positions = ldGetPositions();\n  const interviews = ldGetInterviews();\n  const todos = ldGetTodos();\n  const templates = ldGetTemplates();\n  const hires = ldGetHires();\n  const progress = ldGetProgress();"
)

# Remove api helpers that reference /api/logout etc  
html = re.sub(r'async function api\(path.*?\n}\n', '', html)
html = re.sub(r'async function apiGet\(path\).*?\n}\n', '', html)
html = re.sub(r'async function apiPost\(path, body\).*?\n}\n', '', html)
html = re.sub(r'async function apiPut\(path, body\).*?\n}\n', '', html)
html = re.sub(r'async function apiDelete\(path\).*?\n}\n', '', html)

# Fix the admin hint text
html = html.replace('const canEdit = isAdmin();', 'const canEdit = true;')

# Remove member-only restrictions in interview table
html = html.replace("${isAdmin()?'<th>录入人</th>':''}", '')
html = html.replace("${isAdmin()?`<td style=\"font-size:11px;color:var(--text2)\">${userMap[iv.createdBy]||'-'}</td>`:''}", '')
html = html.replace("const canModify = isAdmin() || iv.createdBy === auth.userId;", "const canModify = true;")
html = html.replace("${canModify?`<button class=\"btn btn-outline btn-xs\" onclick=\"editInterview('${iv.id}')\">编辑</button><button class=\"btn btn-danger btn-xs\" onclick=\"deleteInterview('${iv.id}')\">删除</button>`:`<span style=\"font-size:11px;color:var(--text2)\">只读</span>`}", "<button class=\"btn btn-outline btn-xs\" onclick=\"editInterview('${iv.id}')\">编辑</button><button class=\"btn btn-danger btn-xs\" onclick=\"deleteInterview('${iv.id}')\">删除</button>")

# Fix todo createdBy checks
html = html.replace("const canModify = isAdmin() || t.createdBy === auth.userId", "const canModify = true")
html = html.replace("${isAdmin()&&t.createdBy!==auth.userId?`<span class=\"creator-tag\">${userMap[t.createdBy]||''}</span>`:''}", "")

# Fix hire createdBy checks
html = html.replace("const canModify = isAdmin() || h.createdBy === auth.userId;", "const canModify = true;")
html = html.replace("${isAdmin()&&h.createdBy!==auth.userId?`<span class=\"creator-tag\">${userMap[h.createdBy]||''}</span>`:''}", "")

# Remove team overview in render
html = html.replace("if (!isAdmin()) { document.getElementById('teamOverview').innerHTML = ''; return; }", "")

# Fix progress table admin hint to always show
html = html.replace("if (isAdmin()) html += `<div class=\"admin-hint\">管理员：修改数据后点击\"保存全部修改\"提交。也可点击\"从面试同步\"自动计算入职人数。支持上传表格批量更新。</div>`;", "")

# Fix position board canEdit
html = html.replace("const canEdit = isAdmin();", "const canEdit = true;")
html = re.sub(r'html \+= `<div class="card">\s*<div class="card-header"><h2>岗位列表</h2>\s*\${canEdit \?', 
    'html += `<div class="card"><div class="card-header"><h2>岗位列表</h2>', html)

# Remove auth.userId comparisons
html = html.replace("createdBy: auth.userId", "createdBy: 'local'")
html = html.replace("req.userId", "'local'")
html = html.replace("auth.userId", "'local'")

# Fix the batch import to POST directly via localStorage
# Replace apiPost('/api/interviews/batch'... calls
html = re.sub(
    r"const res = await apiPost\('/api/interviews/batch', \{ items \}\);",
    "const interviews = ldGetInterviews(); interviews.unshift(...items.map(item => ({...item, id: genId(), createdBy: 'local', createdAt: new Date().toISOString().split('T')[0]}))); ldSet('interviews', interviews); const res = { count: items.length };",
    html
)

# Fix positions API calls
html = re.sub(r"await apiPost\('/api/positions', (\{.*?\})\);", r"const pos = \1; pos.id = genId(); pos.createdBy = 'local'; pos.createdAt = new Date().toISOString().split('T')[0]; pos.status = 'active'; pos.stages = pos.stages || {resumeScreen:0,firstInterview:0,secondInterview:0,finalInterview:0,offer:0,onboard:0}; const positions = ldGetPositions(); positions.unshift(pos); ldSet('positions', positions);", html)

html = re.sub(r"await apiPut\('/api/positions/'\+(\w+), (\{.*?\})\);", r"const positions = ldGetPositions(); const idx = positions.findIndex(p => p.id === \1); if (idx >= 0) positions[idx] = {...positions[idx], ...\2}; ldSet('positions', positions);", html)

html = re.sub(r"await apiDelete\('/api/positions/'\+(\w+)\);", r"const positions = ldGetPositions().filter(p => p.id !== \1); ldSet('positions', positions);", html)

# Fix progress API calls  
html = re.sub(r"await apiPost\('/api/progress/batch-import', \{ items \}\);",
    r"const progress = ldGetProgress(); items.forEach(item => { const existing = progress.find(p => p.position === item.position); if (existing) { Object.assign(existing, item); existing.totalEntry = (existing.week1||0)+(existing.week2||0)+(existing.week3||0)+(existing.week4||0); existing.shortage = Math.max(0,(existing.headcount||0)-existing.totalEntry); existing.completion = existing.headcount>0?Math.round(existing.totalEntry/existing.headcount*100)+'%':'0%'; } else { const hc = parseInt(item.headcount)||1; const w1=parseInt(item.week1)||0,w2=parseInt(item.week2)||0,w3=parseInt(item.week3)||0,w4=parseInt(item.week4)||0; const te = w1+w2+w3+w4; progress.push({...item, id: genId(), headcount: hc, week1:w1,week2:w2,week3:w3,week4:w4, totalEntry: te, shortage: Math.max(0,hc-te), completion: hc>0?Math.round(te/hc*100)+'%':'0%', createdBy:'local', createdAt: new Date().toISOString().split('T')[0]}); }}); ldSet('progress', progress);", html)

html = re.sub(r"await apiPost\('/api/positions/batch-import', \{ items \}\);",
    r"const positions = ldGetPositions(); items.forEach(item => { const existing = positions.find(p => p.position === item.position); if (existing) { if (item.dept !== undefined) existing.dept = item.dept; if (item.headcount !== undefined) existing.headcount = parseInt(item.headcount)||existing.headcount; if (item.deadline !== undefined) existing.deadline = item.deadline; if (item.stages) existing.stages = {...existing.stages, ...item.stages}; } else { positions.unshift({...item, id: genId(), headcount: parseInt(item.headcount)||1, stages: item.stages||{resumeScreen:0,firstInterview:0,secondInterview:0,finalInterview:0,offer:0,onboard:0}, status:'active', createdBy:'local', createdAt: new Date().toISOString().split('T')[0]}); }}); ldSet('positions', positions);", html)

# Fix saveAllProgress
html = re.sub(r"await apiPost\('/api/progress/save-all', \{ items \}\);",
    r"ldSet('progress', items);", html)

# Fix template API calls
html = re.sub(r"await apiPost\('/api/templates', (\{.*?\})\);", r"const tpl = \1; tpl.id = genId(); tpl.createdBy = 'local'; tpl.createdAt = new Date().toISOString().split('T')[0]; const templates = ldGetTemplates(); templates.push(tpl); ldSet('templates', templates);", html)

html = re.sub(r"await apiPut\('/api/templates/'\+(\w+), (\{.*?\})\);", r"const templates = ldGetTemplates(); const idx = templates.findIndex(t => t.id === \1); if (idx >= 0) templates[idx] = {...templates[idx], ...\2}; ldSet('templates', templates);", html)

html = re.sub(r"await apiDelete\('/api/templates/'\+(\w+)\);", r"const templates = ldGetTemplates().filter(t => t.id !== \1); ldSet('templates', templates);", html)

html = re.sub(r"await apiPost\('/api/templates/'\+(\w+)\+'/clone'\);", r"const templates = ldGetTemplates(); const tpl = templates.find(t => t.id === \1); if (tpl) { const cloned = {...tpl, id: genId(), name: tpl.name + '(副本)', createdBy: 'local', createdAt: new Date().toISOString().split('T')[0]}; templates.push(cloned); ldSet('templates', templates); }", html)

# Fix todo API calls
html = re.sub(r"await apiPost\('/api/todos', (\{.*?\})\);", r"const todo = \1; todo.id = genId(); todo.createdBy = 'local'; todo.createdAt = new Date().toISOString().split('T')[0]; const todos = ldGetTodos(); todos.unshift(todo); ldSet('todos', todos);", html)

html = re.sub(r"await apiPut\('/api/todos/'\+(\w+), (\{.*?\})\);", r"const todos = ldGetTodos(); const idx = todos.findIndex(t => t.id === \1); if (idx >= 0) todos[idx] = {...todos[idx], ...\2}; ldSet('todos', todos);", html)

html = re.sub(r"await apiDelete\('/api/todos/'\+(\w+)\);", r"const todos = ldGetTodos().filter(t => t.id !== \1); ldSet('todos', todos);", html)

# Fix hire API calls
html = re.sub(r"await apiPost\('/api/hires', (\{.*?\})\);", r"const hire = \1; hire.id = genId(); hire.createdBy = 'local'; hire.createdAt = new Date().toISOString().split('T')[0]; hire.periods = hire.periods || []; const hires = ldGetHires(); hires.unshift(hire); ldSet('hires', hires);", html)

html = re.sub(r"await apiPut\('/api/hires/'\+(\w+), (\{.*?\})\);", r"const hires = ldGetHires(); const idx = hires.findIndex(h => h.id === \1); if (idx >= 0) hires[idx] = {...hires[idx], ...\2}; ldSet('hires', hires);", html)

html = re.sub(r"await apiDelete\('/api/hires/'\+(\w+)\);", r"const hires = ldGetHires().filter(h => h.id !== \1); ldSet('hires', hires);", html)

# Fix hire period and checkin APIs
html = re.sub(r"await apiPost\('/api/hires/'\+(\w+)\+'/periods/'\+(\w+)\+'/checkins', (\{.*?\})\);",
    r"const hires = ldGetHires(); const hire = hires.find(h => h.id === \1); if (hire) { const period = (hire.periods||[]).find(p => p.id === \2); if (period) { period.checkins = period.checkins || []; period.checkins.push(\3); ldSet('hires', hires); } }", html)

html = re.sub(r"await apiDelete\('/api/hires/'\+(\w+)\+'/periods/'\+(\w+)\+'/checkins/'\+(\w+)\);",
    r"const hires = ldGetHires(); const hire = hires.find(h => h.id === \1); if (hire) { const period = (hire.periods||[]).find(p => p.id === \2); if (period) { period.checkins = (period.checkins||[]).filter(c => c.date !== \3); ldSet('hires', hires); } }", html)

html = re.sub(r"await apiPost\('/api/hires/'\+(\w+)\+'/periods', (\{.*?\})\);",
    r"const hires = ldGetHires(); const hire = hires.find(h => h.id === \1); if (hire) { const period = \2; period.id = genId(); period.checkins = []; hire.periods = hire.periods || []; hire.periods.push(period); ldSet('hires', hires); }", html)

html = re.sub(r"await apiDelete\('/api/hires/'\+(\w+)\+'/periods/'\+(\w+)\);",
    r"const hires = ldGetHires(); const hire = hires.find(h => h.id === \1); if (hire) { hire.periods = (hire.periods||[]).filter(p => p.id !== \2); ldSet('hires', hires); }", html)

# Fix interview API calls (single CRUD)
html = re.sub(r"await apiPost\('/api/interviews', (\{.*?\})\);", r"const iv = \1; iv.id = genId(); iv.createdBy = 'local'; iv.createdAt = new Date().toISOString().split('T')[0]; const interviews = ldGetInterviews(); interviews.unshift(iv); ldSet('interviews', interviews);", html)

html = re.sub(r"await apiPut\('/api/interviews/'\+(\w+), (\{.*?\})\);", r"const interviews = ldGetInterviews(); const idx = interviews.findIndex(iv => iv.id === \1); if (idx >= 0) interviews[idx] = {...interviews[idx], ...\2}; ldSet('interviews', interviews);", html)

html = re.sub(r"await apiDelete\('/api/interviews/'\+(\w+)\);", r"const interviews = ldGetInterviews().filter(iv => iv.id !== \1); ldSet('interviews', interviews);", html)

# Fix progress CRUD
html = re.sub(r"await apiPost\('/api/progress', (\{.*?\})\);", r"const p = \1; p.id = genId(); p.createdBy = 'local'; p.createdAt = new Date().toISOString().split('T')[0]; p.totalEntry = (p.week1||0)+(p.week2||0)+(p.week3||0)+(p.week4||0); p.shortage = Math.max(0,(p.headcount||0)-p.totalEntry); p.completion = p.headcount>0?Math.round(p.totalEntry/p.headcount*100)+'%':'0%'; const progress = ldGetProgress(); progress.push(p); ldSet('progress', progress);", html)

html = re.sub(r"await apiDelete\('/api/progress/'\+(\w+)\);", r"const progress = ldGetProgress().filter(p => p.id !== \1); ldSet('progress', progress);", html)

# Fix syncProgress from interview
html = re.sub(r"await apiPost\('/api/progress/sync', \{ position: (\w+)\.position.*?\}\);", r"/* sync skipped in standalone mode */", html)

# Fix progress save-all
html = html.replace(
    "await apiPost('/api/progress/save-all', { items: dirtyItems })",
    "const progress = ldGetProgress(); dirtyItems.forEach(di => { const idx = progress.findIndex(p => p.id === di.id); if (idx >= 0) { progress[idx] = {...progress[idx], ...di}; progress[idx].totalEntry = (progress[idx].week1||0)+(progress[idx].week2||0)+(progress[idx].week3||0)+(progress[idx].week4||0); progress[idx].shortage = Math.max(0,(progress[idx].headcount||0)-progress[idx].totalEntry); progress[idx].completion = progress[idx].headcount>0?Math.round(progress[idx].totalEntry/progress[idx].headcount*100)+'%':'0%'; } }); ldSet('progress', progress)"
)

# Fix batch edit save for positions
html = html.replace(
    "apiPost('/api/positions/batch-edit', { items: batchItems })",
    "ldSet('positions', batchItems)"
)

# Fix remaining users API reference in interview section
html = html.replace(
    "users = await apiGet('/api/users');",
    "users = [];"
)
html = html.replace(
    "let users = [];\n  try { users = await apiGet('/api/users'); } catch(e) {}",
    "let users = [];"
)

# Remove userMap references (not needed in standalone)
html = html.replace(
    "const userMap = {};\n  users.forEach(u => { userMap[u.id] = u.displayName || u.username; });",
    "const userMap = {};"
)

# Remove export/import buttons from old code (we have our own now)
html = re.sub(r'<button[^>]*onclick="exportData\(\)"[^>]*>.*?</button>', '', html)
html = re.sub(r'<button[^>]*onclick="importData\(\)"[^>]*>.*?</button>', '', html)

# remove old renderLoginPage/doLogin references from script init
html = re.sub(r'if \(auth\.token\).*?else \{ showLogin\(\); \}', 'seedLocalData(); render();', html)

with open('F:/workbuddy/hr-team/public/standalone.html', 'w', encoding='utf-8') as f:
    f.write(html)

print('Phase 2+3 complete')
print(f'File size: {len(html)} bytes')
