// 公文写作助手 — 结构诊断（结构审阶段的事实包）
import { countChars, isHeadingRole, isReviewableParagraph, splitSentences } from "./util.js";
import { docTypeLabel } from "./store.js";
import { getProfile, roleHint, validateProfile } from "./profiles.js";

export const STRUCTURE_CHECKLISTS = {
  notice: {
    label: "通知",
    sections: [
      { name: "标题", required: true, hint: "发文机关+事由+文种，如“XX县人民政府办公室关于开展…的通知”" },
      { name: "主送机关", required: true, hint: "顶格，末尾加全角冒号" },
      { name: "发文缘由", required: true, hint: "依据、背景、目的，常用“为…，经…同意，现就…通知如下”" },
      { name: "通知事项", required: true, hint: "时间、范围、任务、责任、要求，分层列明" },
      { name: "执行要求", required: true, hint: "谁来落实、何时反馈、联系人" },
      { name: "落款", required: true, hint: "发文机关全称" },
      { name: "成文日期", required: true, hint: "阿拉伯数字，年月日" },
    ],
    extra: "会议通知另需会议时间、地点、参会人员、报名方式、食宿安排。",
  },
  request: {
    label: "请示",
    sections: [
      { name: "标题", required: true, hint: "关于…的请示" },
      { name: "主送机关", required: true, hint: "只写一个主送机关，不抄送下级" },
      { name: "请示缘由", required: true, hint: "讲清必要性、依据、现状" },
      { name: "请示事项", required: true, hint: "一事一请示，事项具体、可批复" },
      { name: "请示语", required: true, hint: "“妥否，请批示”“以上请示，请予批复”" },
      { name: "落款", required: true, hint: "发文机关全称" },
      { name: "成文日期", required: true, hint: "年月日" },
    ],
    extra: "请示不得夹带报告事项；不得多头主送；不得越级请示。",
  },
  report: {
    label: "报告",
    sections: [
      { name: "标题", required: true, hint: "关于…的报告" },
      { name: "主送机关", required: true, hint: "上级机关" },
      { name: "基本情况", required: true, hint: "工作背景、总体进展" },
      { name: "主要做法", required: true, hint: "措施、机制、创新点" },
      { name: "成效与问题", required: true, hint: "数据支撑，问题不回避" },
      { name: "下一步安排", required: true, hint: "可执行、有时限" },
      { name: "落款", required: true, hint: "发文机关全称" },
      { name: "成文日期", required: true, hint: "年月日" },
    ],
    extra: "报告不夹带请示事项；不以报告代替请示。",
  },
  letter: {
    label: "函",
    sections: [
      { name: "标题", required: true, hint: "关于…的函" },
      { name: "主送机关", required: true, hint: "收函单位" },
      { name: "发函缘由", required: true, hint: "背景、依据、目的" },
      { name: "商洽/询问/答复事项", required: true, hint: "事项明确、边界清楚" },
      { name: "结语", required: true, hint: "“请予支持”“盼复”“此复”等" },
      { name: "落款", required: true, hint: "发函单位全称" },
      { name: "成文日期", required: true, hint: "年月日" },
    ],
    extra: "平行文，语气平等协商；不向不相隶属机关发指令性内容。",
  },
  minutes: {
    label: "会议纪要",
    sections: [
      { name: "会议基本情况", required: true, hint: "时间、地点、主持人、出席、列席" },
      { name: "会议议题", required: true, hint: "逐项列明" },
      { name: "议定事项", required: true, hint: "明确“会议决定”“会议同意”" },
      { name: "责任分工", required: true, hint: "责任单位、完成时限" },
      { name: "落款/日期", required: true, hint: "纪要形成日期" },
    ],
    extra: "纪要只记议定事项，不展开讨论过程；用“会议指出/会议强调/会议要求”。",
  },
  meeting: {
    label: "会议材料",
    sections: [
      { name: "会议名称", required: true, hint: "全称" },
      { name: "时间地点", required: true, hint: "具体到时段、楼层会议室" },
      { name: "参会人员", required: true, hint: "出席、列席、请假要求" },
      { name: "议程", required: true, hint: "逐项、带汇报人和时长" },
      { name: "保障措施", required: true, hint: "材料、签到、设备、保密" },
    ],
    extra: "涉及报名反馈时，附参会人员报名表。",
  },
  speech: {
    label: "讲话稿",
    sections: [
      { name: "称呼", required: true, hint: "“同志们”“各位领导、同志们”" },
      { name: "开场", required: true, hint: "点明会议主题、目的" },
      { name: "主体", required: true, hint: "成绩/形势—问题—要求，层次清楚" },
      { name: "结尾", required: true, hint: "号召、表态、强调落实" },
    ],
    extra: "口语化但不随意；少用长句；重要提法与上级文件保持一致。",
  },
  work_plan: {
    label: "工作方案",
    sections: [
      { name: "指导思想", required: true, hint: "依据、目标导向" },
      { name: "工作目标", required: true, hint: "可量化、可考核" },
      { name: "重点任务", required: true, hint: "任务、措施、责任单位" },
      { name: "实施步骤", required: true, hint: "时间节点、阶段安排" },
      { name: "保障措施", required: true, hint: "组织、经费、督导、宣传" },
    ],
    extra: "任务清单建议用表格或分层序号，避免大段铺陈。",
  },
  opinion: {
    label: "意见",
    sections: [
      { name: "标题", required: true, hint: "关于…的意见" },
      { name: "主送机关", required: true, hint: "执行范围" },
      { name: "总体要求", required: true, hint: "指导思想、基本原则、目标" },
      { name: "主要任务", required: true, hint: "分领域、分条" },
      { name: "保障措施", required: true, hint: "组织、政策、督导" },
    ],
    extra: "意见是指导性文件，重在原则和方向，不宜过细。",
  },
  decision: {
    label: "决定",
    sections: [
      { name: "标题", required: true, hint: "关于…的决定" },
      { name: "主送机关", required: true, hint: "执行范围" },
      { name: "决定事项", required: true, hint: "事项、依据、执行要求" },
      { name: "落款/日期", required: true, hint: "发文机关、日期" },
    ],
    extra: "决定事项必须明确、可执行。",
  },
  reply: {
    label: "批复",
    sections: [
      { name: "标题", required: true, hint: "关于…的批复" },
      { name: "主送机关", required: true, hint: "请示单位" },
      { name: "批复事项", required: true, hint: "同意/不同意及理由" },
      { name: "执行要求", required: true, hint: "落实要求" },
      { name: "落款/日期", required: true, hint: "发文机关、日期" },
    ],
    extra: "批复须针对请示事项，一文一批。",
  },
  summary: {
    label: "总结",
    sections: [
      { name: "基本情况", required: true, hint: "总体概况" },
      { name: "主要做法", required: true, hint: "措施、机制" },
      { name: "成效", required: true, hint: "数据、案例" },
      { name: "问题", required: true, hint: "客观分析" },
      { name: "下一步", required: true, hint: "打算、建议" },
    ],
    extra: "总结要有数据和事例，避免空话。",
  },
  default: {
    label: "公文",
    sections: [
      { name: "标题", required: true, hint: "发文机关+事由+文种" },
      { name: "主送机关", required: true, hint: "顶格加冒号" },
      { name: "正文", required: true, hint: "缘由—事项—要求" },
      { name: "落款", required: true, hint: "发文机关全称" },
      { name: "成文日期", required: true, hint: "年月日" },
    ],
    extra: "",
  },
};

function checklistFor(docType) {
  return STRUCTURE_CHECKLISTS[docType] || STRUCTURE_CHECKLISTS.default;
}

const CLICHES = ["进一步", "切实", "全面", "深入", "着力", "持续", "不断", "严格", "加强", "推进", "扎实", "有力"];

function countOccurrences(text, word) {
  let n = 0;
  let from = 0;
  while (true) {
    const i = text.indexOf(word, from);
    if (i < 0) return n;
    n += 1;
    from = i + word.length;
  }
}

function sectionize(project) {
  const paragraphs = project.paragraphs || [];
  const sections = [];
  let current = { title: "开头", paragraphIds: [], chars: 0, startIndex: 0 };
  paragraphs.forEach((p, index) => {
    if (isHeadingRole(p.role)) {
      if (current.paragraphIds.length) sections.push(current);
      current = { title: p.text, paragraphIds: [p.id], chars: countChars(p.text), startIndex: index };
    } else if (p.text?.trim()) {
      current.paragraphIds.push(p.id);
      current.chars += countChars(p.text);
    }
  });
  if (current.paragraphIds.length) sections.push(current);
  return sections.map((s, i) => ({ ...s, index: i + 1 }));
}

export function analyzeStructure(project) {
  const paragraphs = project.paragraphs || [];
  const titleChars = countChars(project.title);
  const bodyParagraphs = paragraphs.filter((p) => isReviewableParagraph(p) && !isHeadingRole(p.role));
  const headings = paragraphs.filter((p) => isHeadingRole(p.role));
  const allText = paragraphs.map((p) => p.text).join("");
  const totalChars = countChars(allText);

  const sentenceRows = [];
  for (const p of paragraphs) {
    if (!isReviewableParagraph(p)) continue;
    for (const s of splitSentences(p.text)) {
      sentenceRows.push({ paragraphId: p.id, sentenceIndex: s.index, chars: countChars(s.text), text: s.text });
    }
  }
  const longSentences = sentenceRows
    .filter((s) => s.chars > 80)
    .sort((a, b) => b.chars - a.chars)
    .slice(0, 8)
    .map((s) => ({ ...s, text: s.text.length > 120 ? `${s.text.slice(0, 120)}…` : s.text }));

  const longParagraphs = paragraphs
    .filter((p) => countChars(p.text) > 380)
    .map((p, index) => ({ paragraphId: p.id, index: paragraphs.findIndex((x) => x.id === p.id) + 1, chars: countChars(p.text), text: `${p.text.slice(0, 80)}…` }));

  const clicheCounts = Object.fromEntries(CLICHES.map((w) => [w, countOccurrences(allText, w)]).filter(([, n]) => n > 0));
  const clicheTotal = Object.values(clicheCounts).reduce((a, b) => a + b, 0);
  const clicheDensity = totalChars ? (clicheTotal / totalChars) * 100 : 0;

  const openings = new Map();
  for (const p of paragraphs) {
    const key = String(p.text || "").slice(0, 12);
    if (key.length < 8) continue;
    if (!openings.has(key)) openings.set(key, []);
    openings.get(key).push(p.id);
  }
  const duplicateOpenings = [...openings.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([opening, ids]) => ({ opening, paragraphIds: ids }));

  const outlineTitles = (project.outline || []).map((s) => s.title);
  const headingTitles = headings.map((p) => p.text);
  const normalizeHeading = (text) =>
    String(text || "")
      .replace(/^[一二三四五六七八九十百]+、/, "")
      .replace(/^（[一二三四五六七八九十百]+）/, "")
      .replace(/^[0-9]+[.、]/, "")
      .replace(/^（[0-9]+）/, "")
      .trim();
  const outlineMissing = outlineTitles.filter(
    (t) => !headingTitles.some((h) => normalizeHeading(h).includes(normalizeHeading(t)) || normalizeHeading(t).includes(normalizeHeading(h))),
  );
  const unplannedHeadings = headingTitles.filter(
    (h) => !outlineTitles.some((t) => normalizeHeading(h).includes(normalizeHeading(t)) || normalizeHeading(t).includes(normalizeHeading(h))),
  );

  const checklist = checklistFor(project.docType);
  const basicPresent = {
    标题: Boolean(String(project.title || "").trim()),
    主送机关: Boolean(String(project.recipient || "").trim()),
    落款: Boolean(String(project.issuer || "").trim()),
    成文日期: Boolean(String(project.date || "").trim()),
    正文: totalChars > 0,
  };

  const issues = [];
  if (!basicPresent.标题) issues.push({ level: "P1", area: "标题", message: "缺少标题。" });
  else if (titleChars > 60) issues.push({ level: "P2", area: "标题", message: `标题 ${titleChars} 字，偏长，建议压缩到 60 字以内。` });
  if (!basicPresent.主送机关) issues.push({ level: "P1", area: "主送机关", message: "缺少主送机关，公文没有明确的受文对象。" });
  if (!basicPresent.落款) issues.push({ level: "P1", area: "落款", message: "缺少发文机关落款。" });
  if (!basicPresent.成文日期) issues.push({ level: "P1", area: "成文日期", message: "缺少成文日期。" });
  if (!basicPresent.正文) issues.push({ level: "P1", area: "正文", message: "正文为空。" });
  if (totalChars > 600 && headings.length === 0) {
    issues.push({ level: "P2", area: "层次", message: `正文约 ${totalChars} 字但没有一级标题，建议按“一、二、三”分层。` });
  }
  for (const p of longParagraphs.slice(0, 4)) {
    issues.push({ level: "P2", area: "段落", message: `第 ${p.index} 段（${p.id}）约 ${p.chars} 字，偏长，建议拆分为 2-3 段。` });
  }
  if (longSentences.length) {
    issues.push({ level: "P2", area: "句子", message: `有 ${sentenceRows.filter((s) => s.chars > 80).length} 个句子超过 80 字，建议断句。` });
  }
  if (clicheDensity > 2) {
    issues.push({ level: "P3", area: "语言", message: `“进一步/切实/全面”等高频词密度偏高（每百字 ${clicheDensity.toFixed(1)} 个），建议替换为具体动作。` });
  }
  if (duplicateOpenings.length) {
    issues.push({ level: "P3", area: "段落", message: `有 ${duplicateOpenings.length} 组段落开头重复，可能影响层次感。` });
  }

  // 文种画像：字数区间、重心、受众、讲话人
  for (const warning of validateProfile(project)) {
    issues.push({ level: warning.level, area: warning.area, message: warning.message });
  }
  const profile = getProfile(project.docType);
  const headingTexts = headings.map((p) => p.text);
  if (["letter", "request"].includes(project.docType) && headings.length >= 3) {
    issues.push({
      level: "P2",
      area: "重心",
      message: `${profile.label}通常一文一事；当前出现 ${headings.length} 个一级标题，检查是否把多件事写进了一份文。`,
    });
  }
  if (project.docType === "report") {
    const hasProblem = headingTexts.some((t) => /问题|不足|短板|困难/.test(t)) || /存在问题|存在的问题|短板|不足/.test(allText);
    const hasNext = headingTexts.some((t) => /下一步|打算|安排|计划/.test(t)) || /下一步|下一步将|打算/.test(allText);
    if (!hasProblem) issues.push({ level: "P2", area: "结构", message: "报告未看到“存在问题”一节，容易只报喜不报忧。" });
    if (!hasNext) issues.push({ level: "P2", area: "结构", message: "报告未看到“下一步安排”一节，收尾缺少落点。" });
  }
  if (project.docType === "speech" && !roleHint(project.docType, project.speakerRole || project.speaker)) {
    if (project.speakerRole || project.speaker) {
      issues.push({ level: "P2", area: "受众", message: `讲话人“${project.speakerRole || project.speaker}”未匹配到预设身份，注意校准语气和篇幅。` });
    }
  }

  const overview = {
    title: project.title,
    docType: project.docType,
    docTypeLabel: docTypeLabel(project.docType),
    titleChars,
    totalChars,
    wordTarget: project.wordTarget || 0,
    wordRange: profile.wordRange,
    audience: project.audience || "",
    speaker: project.speaker || project.speakerRole || "",
    occasion: project.occasion || "",
    focus: project.focus || "",
    paragraphs: paragraphs.length,
    bodyParagraphs: bodyParagraphs.length,
    headings: headings.length,
    sentences: sentenceRows.length,
    avgParagraphChars: bodyParagraphs.length ? Math.round(totalChars / bodyParagraphs.length) : 0,
    maxParagraphChars: bodyParagraphs.reduce((m, p) => Math.max(m, countChars(p.text)), 0),
    maxSentenceChars: sentenceRows.reduce((m, s) => Math.max(m, s.chars), 0),
    references: (project.references || []).length,
  };

  return {
    overview,
    checklist: {
      docType: checklist.label,
      sections: checklist.sections,
      extra: checklist.extra,
      basicPresent,
    },
    sections: sectionize(project),
    headings: headings.map((p, i) => ({ index: i + 1, id: p.id, text: p.text })),
    longParagraphs,
    longSentences,
    clicheCounts,
    clicheDensity: Number(clicheDensity.toFixed(2)),
    duplicateOpenings,
    outlineDrift: { missing: outlineMissing, unplanned: unplannedHeadings },
    issues,
    reviewableParagraphs: paragraphs.filter((p) => isReviewableParagraph(p)).map((p, i) => ({
      order: i + 1,
      id: p.id,
      role: p.role,
      heading: isHeadingRole(p.role),
      chars: countChars(p.text),
      preview: p.text.length > 50 ? `${p.text.slice(0, 50)}…` : p.text,
    })),
  };
}

export function paragraphView(project, index) {
  const paragraphs = project.paragraphs || [];
  const i = Math.max(0, Math.min(Number(index) || 0, paragraphs.length - 1));
  const p = paragraphs[i];
  if (!p) return null;
  const sentences = splitSentences(p.text).map((s) => ({
    index: s.index,
    chars: countChars(s.text),
    text: s.text,
  }));
  return {
    index: i,
    order: i + 1,
    total: paragraphs.length,
    id: p.id,
    role: p.role,
    heading: isHeadingRole(p.role),
    reviewable: isReviewableParagraph(p),
    section: p.section || "",
    chars: countChars(p.text),
    text: p.text,
    sentences,
    previous: i > 0 ? { id: paragraphs[i - 1].id, preview: paragraphs[i - 1].text.slice(0, 40) } : null,
    next: i + 1 < paragraphs.length ? { id: paragraphs[i + 1].id, preview: paragraphs[i + 1].text.slice(0, 40) } : null,
    reviewed: project.review?.completed?.[p.id]?.status || null,
  };
}

export function reviewProgress(project) {
  const paragraphs = (project.paragraphs || []).filter((p) => isReviewableParagraph(p));
  const completed = project.review?.completed || {};
  const done = (id) => ["reviewed", "skipped"].includes(completed[id]?.status);
  const reviewed = paragraphs.filter((p) => done(p.id)).length;
  return {
    stage: project.review?.stage || "idle",
    cursor: project.review?.cursor || { paragraph: 0, sentence: 0 },
    totalParagraphs: paragraphs.length,
    reviewedParagraphs: reviewed,
    remainingParagraphs: Math.max(0, paragraphs.length - reviewed),
    revisions: (project.revisions || []).length,
    percent: paragraphs.length ? Math.round((reviewed / paragraphs.length) * 100) : 0,
    pending: project.review?.pending || null,
  };
}

export function nextReviewableIndex(project, fromIndex, { includeCompleted = false } = {}) {
  const paragraphs = project.paragraphs || [];
  const completed = project.review?.completed || {};
  const done = (id) => ["reviewed", "skipped"].includes(completed[id]?.status);
  for (let i = Math.max(0, fromIndex); i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (!isReviewableParagraph(p)) continue;
    if (!includeCompleted && done(p.id)) continue;
    return i;
  }
  return -1;
}

export function previousReviewableIndex(project, fromIndex) {
  const paragraphs = project.paragraphs || [];
  for (let i = Math.min(paragraphs.length - 1, fromIndex); i >= 0; i--) {
    if (isReviewableParagraph(paragraphs[i])) return i;
  }
  return -1;
}
