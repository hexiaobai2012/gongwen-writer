// 公文写作助手 — 文种画像：字数区间、重心模型、结构、受众/讲话人校准
export const DOC_PROFILES = {
  notice: {
    label: "通知",
    wordRange: [600, 1500],
    focus: "一件事 + 明确执行要求",
    focusRule: "只通知一件事；事项、责任主体、时限、反馈方式必须写清楚，不做原则性铺陈。",
    structure: ["发文缘由", "通知事项", "执行要求", "落款日期"],
    audience: "下级机关、相关单位或社会公众",
    pitfalls: ["一文多事", "只有要求没有责任主体和时限", "主送机关过宽或过窄", "把通知写成倡议书"],
  },
  request: {
    label: "请示",
    wordRange: [500, 1200],
    focus: "一件事 + 一个明确请求",
    focusRule: "一文一事、一事一请；讲清必要性、依据、方案和请求，不夹带报告事项，不多头主送。",
    structure: ["请示缘由", "请示事项", "请示语", "落款日期"],
    audience: "有审批权的上级机关",
    pitfalls: ["一文多事", "多头主送", "越级请示", "请示里夹带报告", "只提问题不给方案"],
  },
  report: {
    label: "报告",
    wordRange: [1500, 3000],
    focus: "情况—做法—成效—问题—打算",
    focusRule: "先交代基本情况，再写做了什么、成效如何，最后写存在问题和下一步；报告不夹带请示。",
    structure: ["基本情况", "主要做法", "成效", "存在问题", "下一步安排", "落款日期"],
    audience: "上级机关",
    pitfalls: ["以报告代请示", "只报喜不报忧", "数据缺失", "做法写成流水账"],
  },
  letter: {
    label: "函",
    wordRange: [400, 800],
    focus: "一件事 + 商洽/询问/答复",
    focusRule: "函通常只办一件事；平行文，语气平等协商，事项边界清楚，结语明确。",
    structure: ["发函缘由", "商洽/询问/答复事项", "结语", "落款日期"],
    audience: "不相隶属的平行机关或单位",
    pitfalls: ["向平行机关发指令", "一文多事", "语气生硬", "结语缺失"],
  },
  minutes: {
    label: "会议纪要",
    wordRange: [800, 2000],
    focus: "议定事项 + 责任分工",
    focusRule: "只记议定事项，不展开讨论过程；每项决定落到责任单位和时限。",
    structure: ["会议基本情况", "会议议题", "议定事项", "责任分工"],
    audience: "参会单位、相关执行单位",
    pitfalls: ["写成会议记录", "议定事项不明确", "没有责任单位", "讨论过程过多"],
  },
  meeting: {
    label: "会议材料",
    wordRange: [1000, 2500],
    focus: "会议目标 + 议程 + 参会要求",
    focusRule: "围绕会议要解决什么来组织，时间、地点、人员、议程、保障逐项落实。",
    structure: ["会议名称", "时间地点", "参会人员", "议程", "保障措施"],
    audience: "参会单位、参会人员",
    pitfalls: ["议程没有汇报人和时长", "参会范围不清", "报名反馈方式缺失"],
  },
  speech: {
    label: "讲话稿",
    wordRange: [2000, 6000],
    focus: "一个主基调，可含多个分点",
    focusRule: "讲话稿可以多事项，但必须有一个主基调统摄；分点之间要有递进关系，不能并列堆砌。",
    structure: ["称呼", "开场", "主体（形势/成绩—问题—要求）", "结尾"],
    audience: "会场听众，按讲话人身份校准",
    pitfalls: ["通篇口号", "分点之间没有逻辑", "不看对象", "把部门业务讲话写成政府全局讲话"],
    roleHints: {
      局长: { wordRange: [2000, 4000], tone: "业务部署、具体任务、部门协同", focus: "任务清单、责任分工、落实节点" },
      县长: { wordRange: [2500, 5000], tone: "全局站位、压实责任、统筹各方", focus: "意义、形势、重点任务、保障" },
      书记: { wordRange: [2500, 5000], tone: "政治高度、方向把握、作风要求", focus: "方向、原则、干部状态" },
      分管领导: { wordRange: [2000, 3500], tone: "具体部署、问题导向", focus: "分管领域任务和协同" },
    },
  },
  work_plan: {
    label: "工作方案",
    wordRange: [1500, 3000],
    focus: "目标 + 任务 + 步骤 + 保障",
    focusRule: "目标可考核、任务可落地、步骤有时限、保障有责任单位。",
    structure: ["指导思想", "工作目标", "重点任务", "实施步骤", "保障措施"],
    audience: "执行单位、责任部门",
    pitfalls: ["目标空泛", "任务没有责任单位", "步骤没有时间节点", "保障措施喊口号"],
  },
  opinion: {
    label: "意见",
    wordRange: [1500, 3000],
    focus: "原则方向 + 主要任务 + 保障",
    focusRule: "意见重在指导性，讲清总体要求、主要任务和保障措施，不宜过细。",
    structure: ["总体要求", "主要任务", "保障措施"],
    audience: "执行范围内的下级机关",
    pitfalls: ["写成实施方案", "任务没有边界", "原则和具体措施混杂"],
  },
  decision: {
    label: "决定",
    wordRange: [800, 2000],
    focus: "决定事项 + 执行要求",
    focusRule: "决定事项必须明确、可执行，依据充分。",
    structure: ["决定事项", "执行要求", "落款日期"],
    audience: "执行范围内的机关单位",
    pitfalls: ["事项模糊", "依据不足", "执行要求缺失"],
  },
  reply: {
    label: "批复",
    wordRange: [400, 800],
    focus: "一事一批",
    focusRule: "针对请示事项明确同意/不同意及理由，不扩大范围。",
    structure: ["批复事项", "执行要求", "落款日期"],
    audience: "请示单位",
    pitfalls: ["答非所问", "一文多批", "态度含糊"],
  },
  summary: {
    label: "总结",
    wordRange: [1500, 3000],
    focus: "做法—成效—问题—打算",
    focusRule: "用数据和事例支撑，既讲成绩也讲问题，下一步要具体。",
    structure: ["基本情况", "主要做法", "成效", "问题", "下一步"],
    audience: "上级机关或本单位",
    pitfalls: ["罗列工作", "没有数据", "问题一笔带过"],
  },
  announcement: {
    label: "公告",
    wordRange: [400, 1000],
    focus: "一件事 + 告知对象 + 生效安排",
    focusRule: "面向社会告知，事项、范围、时间、办理方式清楚。",
    structure: ["公告缘由", "公告事项", "办理安排", "落款日期"],
    audience: "社会公众",
    pitfalls: ["对象不清", "办理方式缺失", "语气过于内部化"],
  },
  default: {
    label: "公文",
    wordRange: [600, 2000],
    focus: "一个中心 + 清楚的结构",
    focusRule: "先明确这篇公文要解决什么，再按缘由—事项—要求展开。",
    structure: ["标题", "主送机关", "正文", "落款日期"],
    audience: "受文对象",
    pitfalls: ["中心不清", "结构松散", "对象错位"],
  },
};

export function getProfile(docType) {
  return DOC_PROFILES[docType] || DOC_PROFILES.default;
}

export function profileSummary(docType) {
  const p = getProfile(docType);
  return {
    docType,
    label: p.label,
    wordRange: p.wordRange,
    focus: p.focus,
    focusRule: p.focusRule,
    structure: p.structure,
    audience: p.audience,
    pitfalls: p.pitfalls,
    roleHints: p.roleHints || null,
  };
}

export function wordRangeText(docType) {
  const p = getProfile(docType);
  return `${p.wordRange[0]}-${p.wordRange[1]} 字`;
}

export function validateProfile(project) {
  const p = getProfile(project.docType);
  const warnings = [];
  if (project.wordTarget && (project.wordTarget < p.wordRange[0] || project.wordTarget > p.wordRange[1])) {
    warnings.push({
      level: "P2",
      area: "篇幅",
      message: `${p.label}通常 ${p.wordRange[0]}-${p.wordRange[1]} 字，当前目标 ${project.wordTarget} 字，偏离常规区间。`,
    });
  }
  if (!project.focus) {
    warnings.push({ level: "P1", area: "重心", message: "还没有写清这篇公文的中心/重心，容易越写越散。" });
  }
  if (project.docType === "speech") {
    if (!project.speaker && !project.speakerRole) {
      warnings.push({ level: "P1", area: "讲话人", message: "讲话稿需要明确讲话人身份（如局长、县长、书记），否则语气和站位无法校准。" });
    }
    if (!project.audience) {
      warnings.push({ level: "P1", area: "受众", message: "讲话稿需要明确听众是谁，才能决定讲什么、讲多深。" });
    }
  }
  return warnings;
}

export function roleHint(docType, speakerRole) {
  const p = getProfile(docType);
  if (!p.roleHints || !speakerRole) return null;
  const key = Object.keys(p.roleHints).find((k) => String(speakerRole).includes(k));
  return key ? { role: key, ...p.roleHints[key] } : null;
}
