// 输出文档 .docx 生成（规范一·输出文档字体）
// 正式商务文档：中文标题黑体 / 中文正文宋体 / 英文数字 Times New Roman
// 通用工作文档（题本）：中文微软雅黑 / 英文数字 Arial
const { Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType } = require('docx');

const FORMAL = { title: '黑体', body: '宋体', en: 'Times New Roman' };
const GENERAL = { title: '微软雅黑', body: '微软雅黑', en: 'Arial' };

function fontObj(kind, role) {
  const set = kind === 'general' ? GENERAL : FORMAL;
  const cn = role === 'title' ? set.title : set.body;
  return { ascii: set.en, eastAsia: cn, hAnsi: set.en, cs: cn };
}

function run(text, o = {}) {
  return new TextRun({
    text: text == null ? '' : String(text),
    bold: !!o.bold,
    size: o.size || 24,            // 24 = 小四 12pt
    color: o.color,
    font: fontObj(o.kind || 'formal', o.role || 'body'),
  });
}

const CELL_M = { top: 40, bottom: 40, left: 80, right: 80 };
const TBL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'E5E6EB' };
const TBL_BORDERS = { top: TBL_BORDER, bottom: TBL_BORDER, left: TBL_BORDER, right: TBL_BORDER, insideHorizontal: TBL_BORDER, insideVertical: TBL_BORDER };

function titleP(text, kind) {
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 240 }, children: [run(text, { bold: true, size: 44, kind, role: 'title' })] });
}
function h2(text, kind) {
  return new Paragraph({ spacing: { before: 200, after: 120 }, children: [run(text, { bold: true, size: 32, kind, role: 'title' })] });
}
function h3(text, kind) {
  return new Paragraph({ spacing: { before: 140, after: 80 }, children: [run(text, { bold: true, size: 28, kind, role: 'title' })] });
}
function p(text, kind, o = {}) {
  if (Array.isArray(text)) return new Paragraph({ spacing: { after: o.after != null ? o.after : 120, line: 360, lineRule: 'auto' }, children: text });
  return new Paragraph({ spacing: { after: o.after != null ? o.after : 120, line: 360, lineRule: 'auto' }, children: [run(text, { kind, bold: o.bold, color: o.color, size: o.size })] });
}
function bullet(items, kind) {
  return (items || []).filter(Boolean).map(it => new Paragraph({ spacing: { after: 60, line: 360, lineRule: 'auto' }, indent: { left: 360, hanging: 240 }, children: [run('- ', { kind }), run(it, { kind })] }));
}
function ol(items, kind) {
  const arr = (items || []).filter(Boolean); let i = 0;
  return arr.map(it => { i++; return new Paragraph({ spacing: { after: 60, line: 360, lineRule: 'auto' }, indent: { left: 360, hanging: 260 }, children: [run(i + '. ', { kind, bold: true }), run(it, { kind })] }); });
}
function fieldTable(rows, kind) {
  const trs = rows.map(([lab, val]) => new TableRow({
    children: [
      new TableCell({ width: { size: 28, type: WidthType.PERCENTAGE }, shading: { type: ShadingType.CLEAR, fill: 'F7F8FA', color: 'auto' }, margins: CELL_M,
        children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run(lab + '：', { kind, bold: true, size: 24 })] })] }),
      new TableCell({ width: { size: 72, type: WidthType.PERCENTAGE }, margins: CELL_M,
        children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [run(val ? String(val) : '—', { kind, size: 24 })] })] }),
    ],
  }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: TBL_BORDERS, rows: trs });
}

function meta(kind, pairs) {
  return new Paragraph({ spacing: { after: 160, line: 360, lineRule: 'auto' }, children: pairs.map((pr, idx) => run((idx ? '　' : '') + pr[0] + '：' + (pr[1] || '—'), { kind })) });
}

// ===== 1. 人才登记表 =====
function buildTalentRegister(d) {
  const b = (d.parsed && d.parsed.basic) || {};
  const edu = (d.parsed && d.parsed.education || []).map(e => [e.school, e.major, e.degree, e.gradDate].filter(Boolean).join(' / '));
  const work = (d.parsed && d.parsed.work || []).map(w => [w.company, w.position, (w.startDate || '') + '~' + (w.endDate || '')].filter(Boolean).join(' · '));
  const skills = (d.parsed && d.parsed.skills || []).join('、');
  const certs = (d.parsed && d.parsed.certificates || []).join('、');
  const ch = [
    ['姓名', d.name], ['应聘岗位', d.position], ['匹配分数', d.matchScore != null ? d.matchScore + ' 分' : ''],
    ['性别', b.gender], ['年龄', b.age], ['婚育状况', b.maritalStatus], ['现居地', b.currentLocation],
    ['期望工作地', b.expectedLocation], ['联系电话', b.phone], ['当前薪资', b.currentSalary], ['期望薪资', b.expectedSalary],
  ];
  const kids = [titleP('人才登记表', 'formal'), meta('formal', [['登记日期', d.createdAt]]), fieldTable(ch, 'formal')];
  kids.push(h3('教育经历', 'formal'));
  kids.push(edu.length ? new Paragraph({ spacing: { after: 120, line: 360, lineRule: 'auto' }, children: [run(edu.join('\n'), { kind: 'formal' })] }) : p('—', 'formal'));
  kids.push(h3('工作经历', 'formal'));
  kids.push(work.length ? new Paragraph({ spacing: { after: 120, line: 360, lineRule: 'auto' }, children: [run(work.join('\n'), { kind: 'formal' })] }) : p('—', 'formal'));
  kids.push(h3('技能特长', 'formal')); kids.push(p(skills || '—', 'formal'));
  kids.push(h3('证书资质', 'formal')); kids.push(p(certs || '—', 'formal'));
  if (d.matchDetail && d.matchDetail.summary) { kids.push(h3('匹配分析', 'formal')); kids.push(p(d.matchDetail.summary, 'formal')); }
  if (d.anomalies && d.anomalies.issues && d.anomalies.issues.length) {
    kids.push(h3('回填异常提醒', 'formal'));
    kids.push(...bullet(d.anomalies.issues.map(x => '[' + (x.severity || '') + '] ' + (x.type || '') + '：' + (x.desc || '')), 'formal'));
  }
  if (d.tags && d.tags.length) { kids.push(h3('备注标签', 'formal')); kids.push(p(d.tags.join('、'), 'formal')); }
  return doc(kids);
}

// ===== 2. 面试题本（通用工作文档） =====
function buildQuestionBank(d) {
  const kids = [titleP('面试题本', 'general'), meta('general', [['题本标题', d.title], ['候选人', d.candidateName], ['应聘岗位', d.position], ['生成日期', d.createdAt]])];
  const qs = d.questions || [];
  if (!qs.length) kids.push(p('（暂无题目）', 'general'));
  qs.forEach((q, i) => {
    kids.push(h3('第 ' + (i + 1) + ' 题　' + (q.category || ''), 'general'));
    kids.push(p(q.question || '—', 'general'));
    kids.push(p([run('考察要点：', { kind: 'general', bold: true }), run(q.points || '—', { kind: 'general' })], 'general', { after: 60 }));
    kids.push(p([run('评分标准：', { kind: 'general', bold: true }), run(q.scoreStd || '—', { kind: 'general' })], 'general', { after: 60 }));
    kids.push(p([run('追问：', { kind: 'general', bold: true }), run(q.followUp || '—', { kind: 'general' })], 'general', { after: 120 }));
  });
  return doc(kids);
}

// ===== 3. 录用评估报告（正式商务） =====
function buildEvalReport(d) {
  const kids = [titleP('录用评估报告', 'formal'), meta('formal', [['候选人', d.candidateName], ['应聘岗位', d.position], ['评估日期', d.createdAt], ['匹配分数', d.matchScore != null ? d.matchScore + ' 分' : '']])];
  kids.push(h2('一、综合评语', 'formal')); kids.push(p(d.summary || '—', 'formal'));
  kids.push(h2('二、核心优势', 'formal')); kids.push(...bullet(d.strengths, 'formal'));
  kids.push(h2('三、风险关注', 'formal')); kids.push(...bullet(d.risks, 'formal'));
  kids.push(h2('四、薪酬建议', 'formal'));
  kids.push(p([run('建议区间：', { kind: 'formal', bold: true }), run((d.salarySuggestion && d.salarySuggestion.range) || '—', { kind: 'formal' }), run('　', { kind: 'formal' }), run((d.salarySuggestion && d.salarySuggestion.notes) || '', { kind: 'formal' })], 'formal'));
  if (d.recommendation) { kids.push(h2('五、录用建议', 'formal')); kids.push(p([run(d.recommendation, { kind: 'formal', bold: true, color: '165DFF' })], 'formal')); }
  return doc(kids);
}

// ===== 4. 录用建议（正式商务） =====
function buildHireProposal(d) {
  const kids = [titleP('录用建议', 'formal'), meta('formal', [['候选人', d.candidateName], ['应聘岗位', d.position], ['建议日期', d.createdAt], ['匹配分数', d.matchScore != null ? d.matchScore + ' 分' : '']])];
  kids.push(h2('一、录用结论', 'formal')); kids.push(p([run(d.recommendation || '—', { kind: 'formal', bold: true, color: '165DFF' })], 'formal'));
  kids.push(h2('二、评估依据', 'formal')); kids.push(p(d.summary || '—', 'formal'));
  kids.push(h2('三、核心优势', 'formal')); kids.push(...bullet(d.strengths, 'formal'));
  kids.push(h2('四、风险提示', 'formal')); kids.push(...bullet(d.risks, 'formal'));
  kids.push(h2('五、薪酬与到岗', 'formal'));
  kids.push(p([run('薪酬区间：', { kind: 'formal', bold: true }), run((d.salarySuggestion && d.salarySuggestion.range) || '—', { kind: 'formal' }), run('　', { kind: 'formal' }), run((d.salarySuggestion && d.salarySuggestion.notes) || '', { kind: 'formal' })], 'formal'));
  kids.push(h2('六、后续动作', 'formal'));
  kids.push(...bullet(['发出录用意向沟通，确认到岗时间与薪资细节', '同步 HR 准备劳动合同与入职材料', '指定带教人，规划试用期目标'], 'formal'));
  return doc(kids);
}

// ===== 5. 试用期管理方案（正式商务，补充） =====
function buildProbationPlan(d) {
  const kids = [titleP('试用期管理方案', 'formal'), meta('formal', [['候选人', d.candidateName], ['应聘岗位', d.position], ['制定日期', d.createdAt]])];
  kids.push(h2('一、阶段目标', 'formal'));
  (d.goals || []).forEach(g => {
    kids.push(h3(g.phase || '', 'formal'));
    kids.push(p([run('阶段目标：', { kind: 'formal', bold: true }), run(g.objective || '—', { kind: 'formal' })], 'formal', { after: 60 }));
    kids.push(p([run('考核指标：', { kind: 'formal', bold: true }), run(g.kpi || '—', { kind: 'formal' })], 'formal', { after: 60 }));
    kids.push(p([run('评估要点：', { kind: 'formal', bold: true }), run(g.evalPoints || '—', { kind: 'formal' })], 'formal', { after: 120 }));
  });
  if (d.evalTemplate) { kids.push(h2('二、评估说明', 'formal')); kids.push(p(d.evalTemplate, 'formal')); }
  if (d.decisionAdvice) { kids.push(h2('三、决策建议', 'formal')); kids.push(p(d.decisionAdvice, 'formal')); }
  return doc(kids);
}

// ===== 6. 岗位说明书（正式商务，补充） =====
function buildJobSpec(d) {
  const kids = [titleP('岗位说明书', 'formal'), meta('formal', [['岗位名称', d.position], ['所属部门', d.dept], ['岗位层级', d.level]])];
  kids.push(h2('一、岗位职责', 'formal')); kids.push(...ol(d.duties, 'formal'));
  kids.push(h2('二、岗位要求', 'formal')); kids.push(...ol(d.requirementsList || d.requirements, 'formal'));
  if (d.competencies && d.competencies.length) {
    kids.push(h2('三、胜任力模型', 'formal'));
    d.competencies.forEach(c => {
      const items = (c.items || []).map(i => '[' + (i.involve || '') + '] ' + (i.name || '') + '：' + (i.desc || '')).join('；');
      kids.push(p([run((c.category || '') + '：', { kind: 'formal', bold: true }), run(items || '—', { kind: 'formal' })], 'formal', { after: 80 }));
    });
  }
  if (d.complianceNotes) { kids.push(h2('四、合规提示', 'formal')); kids.push(p(d.complianceNotes, 'formal')); }
  return doc(kids);
}

function doc(children) {
  return new Document({ sections: [{ properties: {}, children }] });
}

const BUILDERS = {
  talentRegister: buildTalentRegister,
  questionBank: buildQuestionBank,
  evalReport: buildEvalReport,
  hireProposal: buildHireProposal,
  probationPlan: buildProbationPlan,
  jobSpec: buildJobSpec,
};

function buildDocx(type, data) {
  const fn = BUILDERS[type];
  if (!fn) throw new Error('不支持的文档类型：' + type);
  return fn(data || {});
}

async function toBuffer(document) {
  return Packer.toBuffer(document);
}

module.exports = { buildDocx, toBuffer, BUILDERS };
