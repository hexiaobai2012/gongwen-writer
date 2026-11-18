// 公文写作助手 — 逐层推敲状态机：结构 → 段落 → 句子
import { analyzeStructure, nextReviewableIndex, paragraphView, previousReviewableIndex, reviewProgress } from "./analysis.js";
import { countChars, isReviewableParagraph, nowIso, splitSentences } from "./util.js";

function firstReviewable(project) {
  return nextReviewableIndex(project, 0, { includeCompleted: true });
}

function isDone(project, id) {
  return ["reviewed", "skipped"].includes(project.review?.completed?.[id]?.status);
}

function ensureParagraph(project, ref) {
  const paragraphs = project.paragraphs || [];
  if (ref === undefined || ref === null || ref === "") {
    const index = project.review?.cursor?.paragraph ?? 0;
    return { index, paragraph: paragraphs[index] };
  }
  if (typeof ref === "number" || /^\d+$/.test(String(ref))) {
    const n = Number(ref);
    const index = n >= 1 && n <= paragraphs.length ? n - 1 : n;
    return { index, paragraph: paragraphs[index] };
  }
  const index = paragraphs.findIndex((p) => p.id === String(ref));
  return { index, paragraph: paragraphs[index] };
}

function markReviewed(project, index, status = "reviewed", note = "") {
  const p = project.paragraphs[index];
  if (!p || !isReviewableParagraph(p)) return;
  project.review.completed[p.id] = {
    status,
    note: note || project.review.completed[p.id]?.note || "",
    at: nowIso(),
  };
}

function setCursor(project, index, sentence = 0) {
  project.review.cursor = { paragraph: Math.max(0, index), sentence: Math.max(0, sentence) };
}

function currentItem(project) {
  const index = project.review.cursor.paragraph;
  const view = paragraphView(project, index);
  if (!view) return null;
  const sentenceIndex = view.reviewable && project.review.stage === "sentence" ? project.review.cursor.sentence : null;
  if (sentenceIndex !== null && view.sentences[sentenceIndex]) {
    const s = view.sentences[sentenceIndex];
    return { ...view, currentSentence: s, scope: "sentence" };
  }
  return { ...view, scope: "paragraph" };
}

function nextAction(project) {
  const progress = reviewProgress(project);
  if (progress.stage === "done" || progress.remainingParagraphs === 0) {
    return "所有可审段落已过完。调用 gongwen_polish action=finish，然后导出。";
  }
  return "展示当前段/句的原文与建议，等待用户确认；确认后用 apply 落笔，再 next。";
}

export function startReview(store, project) {
  const index = firstReviewable(project);
  if (index < 0) throw new Error("正文没有可推敲的段落。请先用 gongwen_draft 写入正文。");
  const analysis = analyzeStructure(project);
  project.review.stage = "structure";
  project.review.startedAt = nowIso();
  project.review.structureSummary = project.review.structureSummary || "";
  project.review.pending = null;
  setCursor(project, index, 0);
  project.status = "review";
  store.save(project);
  return {
    stage: "structure",
    analysis,
    progress: reviewProgress(project),
    protocol:
      "先只做结构审：把 analysis.issues 按 P1→P3 归纳成 3-5 条，先讲总体判断，再讲结构问题与调整方案，最后问用户是否按此调整。用户确认前不要改任何段落。",
    nextStep: "用户确认结构后，调用 action=structure 记录方案（可传 outline / paragraphOrder），再 action=next 进入第一段。",
  };
}

export function recordStructure(store, project, { summary, outline, paragraphOrder } = {}) {
  if (summary !== undefined) project.review.structureSummary = String(summary || "");
  if (Array.isArray(outline)) {
    project.outline = outline
      .map((item, i) =>
        typeof item === "string"
          ? { id: `S${i + 1}`, title: item, intent: "" }
          : { id: item?.id || `S${i + 1}`, title: String(item?.title || ""), intent: String(item?.intent || "") },
      )
      .filter((s) => s.title);
  }
  if (Array.isArray(paragraphOrder) && paragraphOrder.length) {
    const map = new Map(project.paragraphs.map((p) => [p.id, p]));
    const ordered = [];
    for (const id of paragraphOrder) {
      const p = map.get(String(id));
      if (p) {
        ordered.push(p);
        map.delete(String(id));
      }
    }
    for (const p of project.paragraphs) {
      if (map.has(p.id)) ordered.push(p);
    }
    project.paragraphs = ordered;
  }
  project.review.stage = "paragraph";
  const first = firstReviewable(project);
  setCursor(project, first >= 0 ? first : 0, 0);
  store.save(project);
  return {
    stage: "paragraph",
    outline: project.outline,
    analysis: analyzeStructure(project),
    current: currentItem(project),
    progress: reviewProgress(project),
    nextStep: "把当前段原文和 1-3 个改法呈现给用户；确认后 propose/apply，再 next。",
  };
}

export function focusItem(store, project, { paragraph, sentence, scope } = {}) {
  const { index, paragraph: p } = ensureParagraph(project, paragraph);
  if (!p) throw new Error(`找不到段落 ${paragraph ?? ""}`);
  if (!isReviewableParagraph(p)) throw new Error(`段落 ${p.id} 是标题/落款，不进入逐段审。`);
  setCursor(project, index, Number(sentence) || 0);
  project.review.stage = scope === "sentence" || sentence !== undefined ? "sentence" : "paragraph";
  if (project.review.stage === "sentence") {
    const sentences = splitSentences(p.text);
    if (!sentences[Number(sentence) || 0]) {
      project.review.stage = "paragraph";
      setCursor(project, index, 0);
    }
  }
  store.save(project);
  return { current: currentItem(project), progress: reviewProgress(project), nextAction: nextAction(project) };
}

export function nextItem(store, project, { includeCompleted = false } = {}) {
  if (project.review.stage === "idle") {
    return startReview(store, project);
  }
  if (project.review.stage === "structure") {
    project.review.stage = "paragraph";
    const first = nextReviewableIndex(project, 0, { includeCompleted: true });
    setCursor(project, first >= 0 ? first : 0, 0);
    store.save(project);
    return { stage: "paragraph", current: currentItem(project), progress: reviewProgress(project), nextAction: nextAction(project) };
  }

  const currentIndex = project.review.cursor.paragraph;
  const current = project.paragraphs[currentIndex];

  if (project.review.stage === "sentence" && current && isReviewableParagraph(current)) {
    const sentences = splitSentences(current.text);
    const nextSentence = project.review.cursor.sentence + 1;
    if (sentences[nextSentence]) {
      setCursor(project, currentIndex, nextSentence);
      store.save(project);
      return { stage: "sentence", current: currentItem(project), progress: reviewProgress(project), nextAction: nextAction(project) };
    }
  }

  if (current && isReviewableParagraph(current) && !isDone(project, current.id)) {
    markReviewed(project, currentIndex, "reviewed");
  }
  let next = nextReviewableIndex(project, currentIndex + 1, { includeCompleted });
  if (next < 0 && !includeCompleted) {
    next = nextReviewableIndex(project, 0, { includeCompleted: false });
  }
  if (next < 0) {
    project.review.stage = "done";
    store.save(project);
    return {
      stage: "done",
      done: true,
      progress: reviewProgress(project),
      message: "所有可审段落已过完。可调用 finish 收尾并导出。",
    };
  }
  project.review.stage = "paragraph";
  setCursor(project, next, 0);
  store.save(project);
  return { stage: "paragraph", current: currentItem(project), progress: reviewProgress(project), nextAction: nextAction(project) };
}

export function rewindItem(store, project) {
  const currentIndex = project.review.cursor.paragraph;
  if (project.review.stage === "sentence" && project.review.cursor.sentence > 0) {
    setCursor(project, currentIndex, project.review.cursor.sentence - 1);
  } else {
    const prev = previousReviewableIndex(project, currentIndex - 1);
    if (prev < 0) throw new Error("已经是第一段，不能继续回退。");
    project.review.stage = "paragraph";
    setCursor(project, prev, 0);
  }
  store.save(project);
  return { current: currentItem(project), progress: reviewProgress(project) };
}

export function showItem(store, project, { paragraph, sentence } = {}) {
  const { index, paragraph: p } = ensureParagraph(project, paragraph);
  if (!p) throw new Error("没有当前段落。");
  if (sentence !== undefined && sentence !== null && p && isReviewableParagraph(p)) {
    const sentences = splitSentences(p.text);
    const s = sentences[Number(sentence)];
    if (!s) throw new Error(`段落 ${p.id} 没有第 ${sentence} 句。`);
    return {
      paragraph: paragraphView(project, index),
      sentence: { index: s.index, chars: countChars(s.text), text: s.text },
      previousSentence: sentences[Number(sentence) - 1] || null,
      nextSentence: sentences[Number(sentence) + 1] || null,
    };
  }
  return { paragraph: paragraphView(project, index), progress: reviewProgress(project) };
}

export function propose(store, project, { paragraph, sentence, scope, options, note } = {}) {
  const { index, paragraph: p } = ensureParagraph(project, paragraph);
  if (!p) throw new Error(`找不到段落 ${paragraph ?? ""}`);
  if (!isReviewableParagraph(p)) throw new Error(`段落 ${p.id} 是标题/落款，不进入逐段审。`);
  const list = Array.isArray(options) ? options : [];
  if (!list.length) throw new Error("propose 需要至少一个 options（候选改法）。");
  let normalized = list.map((option) =>
    typeof option === "string" ? { text: option, note: "" } : { text: String(option?.text || ""), note: String(option?.note || "") },
  );
  normalized = normalized.filter((o) => o.text.trim());
  if (!normalized.length) throw new Error("候选改法不能全为空。");

  let targetScope = scope ? String(scope) : sentence !== undefined ? "sentence" : "paragraph";
  if (targetScope !== "sentence") targetScope = "paragraph";
  let sentenceIndex = null;
  let before = p.text;
  if (targetScope === "sentence") {
    const sentences = splitSentences(p.text);
    sentenceIndex = Number(sentence ?? project.review?.cursor?.sentence ?? 0);
    const s = sentences[sentenceIndex];
    if (!s) {
      targetScope = "paragraph";
      sentenceIndex = null;
    } else {
      before = s.text;
    }
  }

  project.review.stage = targetScope === "sentence" ? "sentence" : "paragraph";
  setCursor(project, index, sentenceIndex ?? 0);
  project.review.pending = {
    id: `C${project.nextReviewNo}`,
    paragraphId: p.id,
    paragraphIndex: index,
    scope: targetScope,
    sentence: sentenceIndex,
    before,
    options: normalized,
    note: String(note || ""),
    createdAt: nowIso(),
  };
  store.save(project);
  return {
    pending: project.review.pending,
    current: currentItem(project),
    nextStep: "把 options 呈现给用户（推荐项排第一并说明理由），等用户选择后 apply；不要自行落笔。",
  };
}

export function applyRevision(store, project, { paragraph, sentence, scope, newText, option, note } = {}) {
  const pending = project.review.pending;
  const target = paragraph ?? pending?.paragraphId;
  const { index, paragraph: p } = ensureParagraph(project, target);
  if (!p) throw new Error(`找不到段落 ${target ?? ""}`);
  if (!isReviewableParagraph(p)) throw new Error(`段落 ${p.id} 是标题/落款，不能按句/段修改；请用 gongwen_draft action=update 改元数据。`);

  const targetScope = scope || pending?.scope || (sentence !== undefined ? "sentence" : "paragraph");
  const sentenceIndex = targetScope === "sentence" ? Number(sentence ?? pending?.sentence ?? 0) : null;
  let replacement = newText !== undefined && newText !== null ? String(newText) : "";
  if (!replacement && pending) {
    const idx = option !== undefined && option !== null ? Number(option) : 0;
    replacement = pending.options[idx]?.text || "";
  }
  if (!replacement.trim()) throw new Error("apply 需要 newText，或指定 pending.options 的 option 序号。");

  let before = p.text;
  let after = "";
  if (targetScope === "sentence") {
    const sentences = splitSentences(p.text);
    const s = sentences[sentenceIndex];
    if (!s) throw new Error(`段落 ${p.id} 没有第 ${sentenceIndex} 句。`);
    before = s.text;
    after = `${p.text.slice(0, s.start)}${replacement}${p.text.slice(s.end)}`;
  } else {
    after = replacement;
  }
  if (before === after) {
    project.review.pending = null;
    store.save(project);
    return { unchanged: true, paragraph: paragraphView(project, index), message: "新文本与原文相同，未产生修改。" };
  }

  p.text = after;
  const revision = {
    id: `R${project.nextReviewNo++}`,
    paragraphId: p.id,
    paragraphIndex: index,
    scope: targetScope,
    sentence: sentenceIndex,
    before,
    after: targetScope === "sentence" ? replacement : after,
    note: String(note || pending?.note || ""),
    at: nowIso(),
    status: "applied",
  };
  project.revisions.push(revision);
  project.review.pending = null;
  project.review.stage = targetScope === "sentence" ? "sentence" : "paragraph";
  setCursor(project, index, sentenceIndex ?? 0);
  project.status = "review";
  if (!project.review.completed[p.id]) {
    project.review.completed[p.id] = { status: "in-progress", at: nowIso() };
  }
  store.save(project);
  return {
    revision,
    paragraph: paragraphView(project, index),
    progress: reviewProgress(project),
    nextStep: targetScope === "sentence" ? "如需继续下一句，调用 next（同段内逐句推进）。" : "如需继续下一段，调用 next。",
  };
}

export function discardPending(store, project) {
  const pending = project.review.pending;
  project.review.pending = null;
  store.save(project);
  return { discarded: pending, progress: reviewProgress(project) };
}

export function skipItem(store, project, { paragraph, note } = {}) {
  project.review.pending = null;
  const { index, paragraph: p } = ensureParagraph(project, paragraph);
  if (!p) throw new Error("没有当前段落。");
  if (!isReviewableParagraph(p)) {
    const next = nextReviewableIndex(project, index + 1, {});
    if (next < 0) {
      project.review.stage = "done";
      store.save(project);
      return { done: true, progress: reviewProgress(project) };
    }
    setCursor(project, next, 0);
    store.save(project);
    return { current: currentItem(project), progress: reviewProgress(project) };
  }
  markReviewed(project, index, "skipped", note);
  project.review.stage = "paragraph";
  const next = nextReviewableIndex(project, index + 1, {});
  if (next < 0) {
    project.review.stage = "done";
    store.save(project);
    return { done: true, skipped: p.id, progress: reviewProgress(project), message: "已完成全部可审段落。" };
  }
  setCursor(project, next, 0);
  store.save(project);
  return { skipped: p.id, current: currentItem(project), progress: reviewProgress(project), nextAction: nextAction(project) };
}

export function finishReview(store, project, { force = false } = {}) {
  if (project.review.pending) {
    throw new Error("还有未处理的候选改法（review.pending）。先 apply 或丢弃后再 finish。");
  }
  const progress = reviewProgress(project);
  if (progress.remainingParagraphs > 0 && !force) {
    return {
      success: false,
      needsConfirm: true,
      progress,
      message: `还有 ${progress.remainingParagraphs} 段未过。确认不再逐段推敲后，用 force=true 收尾。`,
    };
  }
  project.review.stage = "done";
  project.status = "finalized";
  store.save(project);
  const analysis = analyzeStructure(project);
  return {
    success: true,
    progress,
    stats: store.stats(project),
    analysis: {
      overview: analysis.overview,
      issues: analysis.issues,
      outlineDrift: analysis.outlineDrift,
    },
    nextStep: "调用 gongwen_export action=export 导出 Word；导出后核对 P0 与占位符。",
  };
}

export function getStatus(store, project) {
  return {
    project: { id: project.id, title: project.title, docType: project.docType, status: project.status },
    review: reviewProgress(project),
    current: currentItem(project),
    recentRevisions: project.revisions.slice(-8),
  };
}

export function getHistory(store, project, { paragraph } = {}) {
  let list = project.revisions;
  if (paragraph) {
    const { paragraph: p } = ensureParagraph(project, paragraph);
    if (p) list = list.filter((r) => r.paragraphId === p.id);
  }
  return {
    total: list.length,
    revisions: list.slice(-50).map((r) => ({
      id: r.id,
      paragraphId: r.paragraphId,
      scope: r.scope,
      sentence: r.sentence,
      before: r.before.length > 200 ? `${r.before.slice(0, 200)}…` : r.before,
      after: r.after.length > 200 ? `${r.after.slice(0, 200)}…` : r.after,
      note: r.note,
      at: r.at,
    })),
  };
}
