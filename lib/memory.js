// 公文写作助手 — 项目记忆与首轮判读
import { countChars, isHeadingRole } from "./util.js";
import { getProfile, roleHint, validateProfile } from "./profiles.js";

const STOPWORDS = new Set([
  "关于", "通知", "报告", "请示", "意见", "方案", "工作", "有关", "进一步", "全面", "切实", "加强", "推进",
  "深入", "认真", "严格", "持续", "不断", "着力", "扎实", "有力", "为了", "根据", "按照", "现将", "如下",
]);

function firstSentence(text) {
  const s = String(text || "").replace(/\s+/g, "");
  const m = /^(.{10,80}?[。！？；])/.exec(s);
  return m ? m[1] : s.slice(0, 60);
}

function sectionPurpose(heading, bodyText) {
  const h = String(heading || "");
  const t = `${h}${bodyText || ""}`;
  if (!h && /为.{0,80}(现将|如下|通知如下)/.test(t)) return "交代发文缘由、引出下文";
  if (/时间|期限|节点/.test(h)) return "明确时间安排";
  if (/范围|对象|场所/.test(h)) return "明确范围/对象";
  if (/内容|事项|任务/.test(h)) return "明确具体事项";
  if (/要求|责任|落实|保障/.test(h)) return "提要求、明责任、定时限";
  if (/形势|认识|意义/.test(h)) return "分析形势、统一认识";
  if (/问题|不足|短板|困难/.test(h)) return "点问题、不回避矛盾";
  if (/下一步|打算|计划/.test(h)) return "下一步安排";
  if (/成效|成果/.test(h)) return "摆成效、用数据支撑";
  if (/做法|措施/.test(h)) return "写做法和重点任务";
  if (/情况|现状|总体/.test(t)) return "交代基本情况";
  if (/同志们|今天召开|主要任务/.test(t)) return "开场点题、说明会议任务";
  if (/缘由|背景|依据|为深入|为贯彻|为落实|根据|按照/.test(t)) return "交代背景、依据和目的";
  if (/要求|分工|时限|保障/.test(t)) return "提要求、明责任、定时限";
  if (/做法|措施|推进|开展|抓好|重点/.test(t)) return "写做法和重点任务";
  return "展开本段核心内容";
}

function guessFocus(project) {
  if (project.focus) return { text: project.focus, source: "已填写" };
  const title = String(project.title || "").replace(/^关于/, "").replace(/(的)?(通知|报告|请示|函|意见|方案|纪要|讲话|决定|批复)$/, "");
  const first = project.paragraphs?.find((p) => p.role === "body")?.text || "";
  const terms = new Map();
  const all = `${project.title || ""}${(project.paragraphs || []).map((p) => p.text).join("")}`;
  for (const m of all.matchAll(/[\u4e00-\u9fa5]{2,8}/g)) {
    const w = m[0];
    if (w.length < 2 || STOPWORDS.has(w)) continue;
    terms.set(w, (terms.get(w) || 0) + 1);
  }
  const top = [...terms.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
  const text = title ? `围绕“${title}”，重点回答“做什么、谁来做、什么时候完成、做到什么程度”。` : "尚未明确重心。";
  return { text, source: "根据标题/正文推测", keywords: top, firstSentence: firstSentence(first) };
}

export function buildDigest(project, { maxChars = 2800 } = {}) {
  const profile = getProfile(project.docType);
  const stats = {
    chars: (project.paragraphs || []).reduce((n, p) => n + countChars(p.text), 0),
    paragraphs: (project.paragraphs || []).filter((p) => p.role === "body").length,
  };
  const lines = [];
  const targetText = project.wordTarget
    ? `目标 ${project.wordTarget} 字`
    : `建议 ${profile.wordRange[0]}-${profile.wordRange[1]} 字`;
  lines.push("【公文项目记忆】");
  lines.push(`文种：${profile.label}（${project.docType}）｜${targetText}｜已写 ${stats.chars} 字`);
  lines.push(`标题：${project.title || "未定"}`);
  if (project.audience) lines.push(`受众：${project.audience}`);
  if (project.speaker || project.speakerRole) lines.push(`讲话人：${project.speaker || ""}${project.speakerRole ? `（${project.speakerRole}）` : ""}`);
  if (project.occasion) lines.push(`场合：${project.occasion}`);
  if (project.focus) lines.push(`重心：${project.focus}`);
  if (project.keyPoints?.length) lines.push(`必须写到：${project.keyPoints.join("；")}`);
  if (project.mustInclude?.length) lines.push(`不可遗漏：${project.mustInclude.join("；")}`);
  if (project.avoid?.length) lines.push(`避免：${project.avoid.join("；")}`);
  if (project.frameCandidates?.length) {
    lines.push(
      `框架候选：${project.frameCandidates
        .map((f) => `${f.id}.${f.title}${f.sections?.length ? `（${f.sections.length}节）` : ""}`)
        .join("；")}${project.selectedFrame ? `；已选 ${project.selectedFrame}` : "；尚未选定"}`,
    );
  }
  if (project.outline?.length) {
    lines.push(`结构：${project.outline.map((s, i) => `${i + 1}.${s.title}${s.intent ? `（${s.intent}）` : ""}`).join("；")}`);
  }
  const review = project.review || {};
  lines.push(`推敲进度：${review.stage || "idle"}，光标第 ${(review.cursor?.paragraph || 0) + 1} 段`);
  if (project.memory?.summary) lines.push(`阶段总结：${project.memory.summary}`);
  const decisions = (project.memory?.decisions || []).slice(-6);
  if (decisions.length) lines.push(`已定事项：${decisions.map((d) => (typeof d === "string" ? d : d.text || "")).filter(Boolean).join("；")}`);
  const issues = (project.memory?.openIssues || []).slice(-6);
  if (issues.length) lines.push(`待办/风险：${issues.map((d) => (typeof d === "string" ? d : d.text || "")).filter(Boolean).join("；")}`);
  if (project.factcheck) {
    const fc = project.factcheck;
    const open = Number(fc.p0Open) || 0;
    const remaining = fc.summary
      ? (Number(fc.summary.conflict) || 0) + (Number(fc.summary.unverified) || 0) + (Number(fc.summary.needsReview) || 0)
      : 0;
    const stale = Number(fc.revisionCount) !== (project.revisions || []).length;
    lines.push(
      `政治核查：${fc.checkedAt ? "已核查" : "未记录时间"}${open ? `，P0 未决 ${open} 条` : "，P0 已清零"}${remaining ? `；待处理 ${remaining} 条` : ""}${stale ? "；核查后正文已修改，需重查" : ""}`,
    );
  }
  const recent = (project.revisions || []).slice(-5);
  if (recent.length) {
    lines.push(
      `最近改动：${recent
        .map((r) => `${r.paragraphId}${r.scope === "sentence" ? `句${(r.sentence ?? 0) + 1}` : ""}${r.note ? `（${r.note}）` : ""}`)
        .join("；")}`,
    );
  }
  const text = lines.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…（记忆已截断）` : text;
}

export function buildBrief(project) {
  const profile = getProfile(project.docType);
  const paragraphs = project.paragraphs || [];
  const sections = [];
  let current = { title: "开头", heading: "", items: [] };
  for (const p of paragraphs) {
    if (isHeadingRole(p.role)) {
      if (current.items.length || current.heading) sections.push(current);
      current = { title: p.text, heading: p.text, items: [] };
    } else if (p.text?.trim()) {
      current.items.push(p);
    }
  }
  if (current.items.length || current.heading) sections.push(current);

  const sectionBriefs = sections.map((s, i) => {
    const text = s.items.map((p) => p.text).join("");
    return {
      order: i + 1,
      heading: s.heading || "开头（无小标题）",
      chars: countChars(text),
      purpose: sectionPurpose(s.heading, text),
      firstSentence: firstSentence(text),
    };
  });

  const focus = guessFocus(project);
  const hint = roleHint(project.docType, project.speakerRole || project.speaker);
  const title = String(project.title || "");
  const titleIssues = [];
  if (!title) titleIssues.push("还没有标题。");
  else {
    if (!/关于|决定|公告|通告|纪要|批复|通知|报告|请示|意见|方案|函|讲话/.test(title)) titleIssues.push("标题里没有出现事由或文种，读者一眼看不出要办什么。");
    if (countChars(title) > 60) titleIssues.push(`标题 ${countChars(title)} 字，偏长。`);
  }

  const stats = {
    chars: paragraphs.reduce((n, p) => n + countChars(p.text), 0),
    paragraphs: paragraphs.filter((p) => p.role === "body").length,
    headings: paragraphs.filter((p) => isHeadingRole(p.role)).length,
  };
  const wordDeviation =
    project.wordTarget && (project.wordTarget < profile.wordRange[0] || project.wordTarget > profile.wordRange[1])
      ? `目标 ${project.wordTarget} 字，${profile.label}常规 ${profile.wordRange[0]}-${profile.wordRange[1]} 字。`
      : "";

  const questions = [
    `这篇稿子最想让受文对象记住或做的一件事是什么？`,
    `文种是否准确（${profile.label}）？有没有把请示/报告/函混用？`,
    project.docType === "speech"
      ? `讲话人是谁、听众是谁？${hint ? `按“${hint.role}”写，重心应为${hint.focus}。` : "不同身份语气和篇幅差别很大。"}`
      : `主送机关/受众是谁？这决定哪些话能写、哪些话不能写。`,
    `哪些事实、数据、时间、人名必须核实？`,
    `哪些内容必须写、哪些内容明确不能写？`,
  ];

  return {
    profile: {
      label: profile.label,
      wordRange: profile.wordRange,
      focus: profile.focus,
      focusRule: profile.focusRule,
      structure: profile.structure,
      pitfalls: profile.pitfalls,
      roleHint: hint,
    },
    title,
    titleIssues,
    focus,
    stats,
    wordDeviation,
    logic: sectionBriefs,
    logicChain: sectionBriefs.map((s, i) => `${i + 1}. ${s.heading} → ${s.purpose}`),
    questions,
    warnings: validateProfile(project),
    next:
      "先不要改正文。先用一段话回答：重心是什么、题目是否合适、分几节、每节干什么、整体逻辑是否成立；再列出需要用户确认的 1-3 个问题。",
  };
}

export function buildMemoryContext(project) {
  if (!project) return "";
  if (!project.paragraphs?.length && !project.outline?.length) return "";
  return buildDigest(project, { maxChars: 2400 });
}
