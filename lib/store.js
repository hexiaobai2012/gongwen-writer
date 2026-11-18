// 公文写作助手 — 项目存储（工作区 .gongwen-writer/projects/<id>/project.json）
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  countChars,
  inferRole,
  isHeadingRole,
  isReviewableParagraph,
  normalizeMultilineText,
  normalizeParagraphText,
  nowIso,
  projectId,
  splitSentences,
} from "./util.js";

export const DOC_TYPE_LABELS = {
  announcement: "公告",
  bill: "议案",
  bulletin: "公报",
  command: "命令",
  communique: "公告",
  decision: "决定",
  host_speech: "主持词",
  instruction: "指示",
  letter: "函",
  meeting: "会议材料",
  minutes: "会议纪要",
  news: "消息",
  notice: "通知",
  notice_public: "公开通知",
  opinion: "意见",
  regulation: "规定",
  reply: "批复",
  report: "报告",
  request: "请示",
  resolution: "决议",
  speech: "讲话稿",
  summary: "总结",
  table_sign: "桌签",
  technical_proposal: "技术方案",
  work_plan: "工作方案",
};

export function docTypeLabel(docType) {
  return DOC_TYPE_LABELS[docType] || docType || "公文";
}

function todayCn() {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function defaultProject() {
  return {
    schemaVersion: 1,
    id: projectId(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    title: "",
    docType: "notice",
    issuer: "",
    recipient: "",
    date: todayCn(),
    topic: "",
    requirements: "",
    style: "务实严谨",
    wordTarget: 0,
    audience: "",
    speaker: "",
    speakerRole: "",
    occasion: "",
    focus: "",
    keyPoints: [],
    mustInclude: [],
    avoid: [],
    status: "outline",
    outline: [],
    frameCandidates: [],
    frameResearch: [],
    selectedFrame: "",
    paragraphs: [],
    nextParagraphNo: 1,
    nextRefNo: 1,
    nextReviewNo: 1,
    review: {
      stage: "idle",
      cursor: { paragraph: 0, sentence: 0 },
      startedAt: null,
      structureSummary: "",
      completed: {},
      pending: null,
    },
    memory: {
      summary: "",
      decisions: [],
      openIssues: [],
      updatedAt: null,
    },
    preview: null,
    previewRevision: 0,
    sourcePath: "",
    revisions: [],
    references: [],
  };
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((x) => normalizeParagraphText(x)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/\n|；|;/)
      .map((x) => normalizeParagraphText(x))
      .filter(Boolean);
  }
  return [];
}

function normalizeOutline(outline, paragraphs) {
  let source = Array.isArray(outline) ? outline : [];
  if (!source.length) {
    source = (paragraphs || [])
      .filter((p) => isHeadingRole(p.role))
      .map((p) => ({ title: p.text }));
  }
  return source
    .map((item, i) => {
      if (typeof item === "string") {
        return { id: `S${i + 1}`, title: normalizeParagraphText(item), intent: "" };
      }
      return {
        id: item?.id ? String(item.id) : `S${i + 1}`,
        title: normalizeParagraphText(item?.title || item?.name || ""),
        intent: normalizeParagraphText(item?.intent || item?.description || ""),
      };
    })
    .filter((s) => s.title)
    .map((s, i) => ({ ...s, id: s.id || `S${i + 1}` }));
}

function normalizeFrames(frames) {
  const list = Array.isArray(frames) ? frames : [];
  return list
    .map((item, i) => {
      if (typeof item === "string") {
        return {
          id: `F${i + 1}`,
          title: normalizeParagraphText(item),
          sections: [],
          logic: "",
          bestFor: "",
          risk: "",
        };
      }
      const sections = normalizeOutline(item?.sections || item?.outline || [], []);
      return {
        id: item?.id ? String(item.id) : `F${i + 1}`,
        title: normalizeParagraphText(item?.title || item?.name || ""),
        sections,
        logic: normalizeParagraphText(item?.logic || item?.logicChain || ""),
        bestFor: normalizeParagraphText(item?.bestFor || item?.fit || ""),
        risk: normalizeParagraphText(item?.risk || item?.pitfall || ""),
      };
    })
    .filter((frame) => frame.title)
    .map((frame, i) => ({ ...frame, id: frame.id || `F${i + 1}` }));
}

function normalizeParagraphList(project, input) {
  const list = Array.isArray(input) ? input : [];
  const out = [];
  for (const item of list) {
    const text = normalizeParagraphText(typeof item === "string" ? item : item?.text);
    if (!text) continue;
    const role = (item && typeof item === "object" && item.role) || inferRole(text);
    out.push({
      id: `P${project.nextParagraphNo++}`,
      role,
      section: item && typeof item === "object" && item.section ? String(item.section) : "",
      text,
      reviewable: item && typeof item === "object" && item.reviewable === false ? false : true,
    });
  }
  return out;
}

function ensureProjectShape(project) {
  const base = defaultProject();
  const merged = { ...base, ...project };
  merged.review = { ...base.review, ...(project.review || {}) };
  merged.review.cursor = { paragraph: 0, sentence: 0, ...(project.review?.cursor || {}) };
  merged.review.completed = { ...(project.review?.completed || {}) };
  merged.memory = { ...base.memory, ...(project.memory || {}) };
  merged.memory.decisions = Array.isArray(project.memory?.decisions) ? project.memory.decisions : [];
  merged.memory.openIssues = Array.isArray(project.memory?.openIssues) ? project.memory.openIssues : [];
  merged.keyPoints = Array.isArray(project.keyPoints) ? project.keyPoints : [];
  merged.mustInclude = Array.isArray(project.mustInclude) ? project.mustInclude : [];
  merged.avoid = Array.isArray(project.avoid) ? project.avoid : [];
  merged.preview = project.preview && typeof project.preview === "object" ? project.preview : null;
  merged.previewRevision = Number(project.previewRevision) || 0;
  merged.sourcePath = String(project.sourcePath || "");
  merged.outline = Array.isArray(project.outline) ? project.outline : [];
  merged.frameCandidates = normalizeFrames(project.frameCandidates);
  merged.frameResearch = Array.isArray(project.frameResearch) ? project.frameResearch : [];
  merged.selectedFrame = String(project.selectedFrame || "");
  merged.paragraphs = Array.isArray(project.paragraphs) ? project.paragraphs : [];
  merged.revisions = Array.isArray(project.revisions) ? project.revisions : [];
  merged.references = Array.isArray(project.references) ? project.references : [];
  merged.nextParagraphNo = Number(project.nextParagraphNo) || maxParagraphNo(merged.paragraphs) + 1;
  merged.nextRefNo = Number(project.nextRefNo) || merged.references.length + 1;
  merged.nextReviewNo = Number(project.nextReviewNo) || merged.revisions.length + 1;
  for (const p of merged.paragraphs) {
    if (!p.id) p.id = `P${merged.nextParagraphNo++}`;
    if (!p.role) p.role = inferRole(p.text);
    p.text = normalizeParagraphText(p.text);
  }
  return merged;
}

function maxParagraphNo(paragraphs) {
  let max = 0;
  for (const p of paragraphs || []) {
    const m = /^P(\d+)$/.exec(String(p.id || ""));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function yamlValue(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/^["']|["']$/g, "")
    .trim();
}

export class ProjectStore {
  constructor(workspace) {
    this.workspace = workspace;
    this.baseDir = join(workspace, ".gongwen-writer");
    this.projectsDir = join(this.baseDir, "projects");
    this.tmpDir = join(this.baseDir, ".tmp");
    this.runtimeDir = join(this.baseDir, ".runtime");
    this.ensure();
  }

  ensure() {
    for (const dir of [this.baseDir, this.projectsDir, this.tmpDir, this.runtimeDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  projectDir(project) {
    return join(this.projectsDir, project.id);
  }

  refsDir(project) {
    return join(this.projectDir(project), "refs");
  }

  exportsDir(project) {
    return join(this.projectDir(project), "exports");
  }

  ensureProjectDirs(project) {
    for (const dir of [this.projectDir(project), this.refsDir(project), this.exportsDir(project)]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  list() {
    const out = [];
    if (!existsSync(this.projectsDir)) return out;
    for (const name of readdirSync(this.projectsDir, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const file = join(this.projectsDir, name.name, "project.json");
      if (!existsSync(file)) continue;
      try {
        const p = ensureProjectShape(JSON.parse(readFileSync(file, "utf8")));
        out.push({
          id: p.id,
          title: p.title,
          docType: p.docType,
          docTypeLabel: docTypeLabel(p.docType),
          status: p.status,
          updatedAt: p.updatedAt,
          paragraphs: p.paragraphs.filter((x) => x.text).length,
          chars: p.paragraphs.reduce((n, x) => n + countChars(x.text), 0),
          reviewStage: p.review?.stage || "idle",
        });
      } catch {
        // 跳过损坏的项目
      }
    }
    out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return out;
  }

  latest() {
    return this.list()[0] || null;
  }

  load(ref) {
    const target = String(ref || "").trim();
    if (!target || target === "latest" || target === "最近") {
      const latest = this.latest();
      if (!latest) throw new Error("当前工作区还没有公文写作项目。先调用 gongwen_draft action=create 新建。");
      return this.load(latest.id);
    }
    const direct = join(this.projectsDir, target, "project.json");
    if (existsSync(direct)) {
      return ensureProjectShape(JSON.parse(readFileSync(direct, "utf8")));
    }
    for (const item of this.list()) {
      if (item.id === target) return this.load(item.id);
    }
    const all = this.list();
    throw new Error(
      `找不到项目「${target}」。可用项目：${all.map((x) => `${x.id}（${x.title || "未命名"}）`).join("；") || "无"}`,
    );
  }

  save(project) {
    project.updatedAt = nowIso();
    this.ensureProjectDirs(project);
    const file = join(this.projectDir(project), "project.json");
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(project, null, 2), "utf8");
    renameSync(tmp, file);
    this.writeMarkdown(project);
    return project;
  }

  create(input = {}) {
    const project = defaultProject();
    const title = normalizeParagraphText(input.title);
    const paragraphs = normalizeParagraphList(project, input.paragraphs);
    const first = paragraphs[0]?.text || "";
    const firstLooksLikeTitle =
      first.length > 4 && first.length <= 60 && !/[。；]/.test(first) && /(关于|通知|报告|请示|函|纪要|决定|意见|方案|讲话|公告|批复)/.test(first);
    project.title = title || (firstLooksLikeTitle ? first : "") || "未命名公文";
    project.docType = String(input.docType || "notice").trim() || "notice";
    project.issuer = normalizeMultilineText(input.issuer);
    project.recipient = normalizeParagraphText(input.recipient);
    project.date = normalizeParagraphText(input.date) || todayCn();
    project.topic = normalizeParagraphText(input.topic);
    project.requirements = normalizeParagraphText(input.requirements);
    project.style = normalizeParagraphText(input.style) || "务实严谨";
    project.wordTarget = Number(input.wordTarget) > 0 ? Number(input.wordTarget) : 0;
    project.audience = normalizeParagraphText(input.audience);
    project.speaker = normalizeParagraphText(input.speaker);
    project.speakerRole = normalizeParagraphText(input.speakerRole);
    project.occasion = normalizeParagraphText(input.occasion);
    project.focus = normalizeParagraphText(input.focus);
    project.keyPoints = normalizeList(input.keyPoints);
    project.mustInclude = normalizeList(input.mustInclude);
    project.avoid = normalizeList(input.avoid);
    project.sourcePath = normalizeParagraphText(input.sourcePath);
    project.paragraphs = paragraphs;
    project.outline = normalizeOutline(input.outline, paragraphs);
    project.status = paragraphs.length ? "drafting" : "outline";
    project.review.stage = "idle";
    return this.save(project);
  }

  setFrames(project, frames, { researchNotes = [] } = {}) {
    project.frameCandidates = normalizeFrames(frames);
    project.frameResearch = normalizeList(researchNotes);
    project.selectedFrame = "";
    project.status = "framing";
    return this.save(project);
  }

  selectFrame(project, ref) {
    const frames = project.frameCandidates || [];
    if (!frames.length) throw new Error("还没有框架候选；先调用 action=frames 保存候选。");
    const key = String(ref ?? "").trim();
    const index = /^\d+$/.test(key) ? Number(key) - 1 : frames.findIndex((f) => f.id === key);
    const frame = frames[index];
    if (!frame) throw new Error(`找不到框架 ${ref ?? ""}；可选：${frames.map((f) => f.id).join("、")}`);
    if (!frame.sections?.length) throw new Error(`框架 ${frame.id} 没有分节，不能作为写作提纲。`);
    project.selectedFrame = frame.id;
    project.outline = frame.sections;
    project.status = project.paragraphs.length ? "drafting" : "outline";
    return this.save(project);
  }

  update(project, patch = {}) {
    const stringFields = [
      "title",
      "docType",
      "issuer",
      "recipient",
      "date",
      "topic",
      "requirements",
      "style",
      "status",
      "audience",
      "speaker",
      "speakerRole",
      "occasion",
      "focus",
    ];
    for (const key of stringFields) {
      if (patch[key] !== undefined && patch[key] !== null) {
        project[key] = key === "issuer" ? normalizeMultilineText(patch[key]) : normalizeParagraphText(patch[key]);
      }
    }
    if (patch.wordTarget !== undefined && patch.wordTarget !== null) {
      const n = Number(patch.wordTarget);
      project.wordTarget = Number.isFinite(n) ? n : project.wordTarget;
    }
    for (const key of ["keyPoints", "mustInclude", "avoid"]) {
      if (patch[key] !== undefined) project[key] = normalizeList(patch[key]);
    }
    if (patch.memory && typeof patch.memory === "object") {
      project.memory = {
        ...project.memory,
        ...patch.memory,
        decisions: Array.isArray(patch.memory.decisions)
          ? patch.memory.decisions
          : project.memory.decisions,
        openIssues: Array.isArray(patch.memory.openIssues)
          ? patch.memory.openIssues
          : project.memory.openIssues,
        updatedAt: nowIso(),
      };
    }
    if (patch.outline !== undefined) {
      project.outline = normalizeOutline(patch.outline, project.paragraphs);
    }
    return this.save(project);
  }

  replaceParagraphs(project, input) {
    project.paragraphs = normalizeParagraphList(project, input);
    project.status = project.paragraphs.length ? "drafting" : "outline";
    project.review = {
      stage: "idle",
      cursor: { paragraph: 0, sentence: 0 },
      startedAt: null,
      structureSummary: "",
      completed: {},
      pending: null,
    };
    return this.save(project);
  }

  insertParagraph(project, { text, role, after, before, section } = {}) {
    const value = normalizeParagraphText(text);
    if (!value) throw new Error("insert 需要非空 text。");
    const paragraph = {
      id: `P${project.nextParagraphNo++}`,
      role: role || inferRole(value),
      section: section || "",
      text: value,
      reviewable: true,
    };
    const anchorId = String(after || before || "");
    let index = project.paragraphs.length;
    if (anchorId) {
      const anchor = project.paragraphs.findIndex((p) => p.id === anchorId);
      if (anchor < 0) throw new Error(`找不到锚点段落 ${anchorId}`);
      index = before ? anchor : anchor + 1;
    }
    project.paragraphs.splice(index, 0, paragraph);
    project.status = "drafting";
    this.save(project);
    return paragraph;
  }

  deleteParagraph(project, paragraphId) {
    const index = project.paragraphs.findIndex((p) => p.id === paragraphId);
    if (index < 0) throw new Error(`找不到段落 ${paragraphId}`);
    const [removed] = project.paragraphs.splice(index, 1);
    project.review.cursor.paragraph = Math.min(project.review.cursor.paragraph, Math.max(0, project.paragraphs.length - 1));
    this.save(project);
    return removed;
  }

  moveParagraph(project, paragraphId, { before, after } = {}) {
    const from = project.paragraphs.findIndex((p) => p.id === paragraphId);
    if (from < 0) throw new Error(`找不到段落 ${paragraphId}`);
    const anchorId = before || after;
    if (!anchorId) throw new Error("move 需要 before 或 after 目标段落。");
    const [item] = project.paragraphs.splice(from, 1);
    let to = project.paragraphs.findIndex((p) => p.id === anchorId);
    if (to < 0) throw new Error(`找不到目标段落 ${anchorId}`);
    if (!before) to += 1;
    project.paragraphs.splice(to, 0, item);
    this.save(project);
    return item;
  }

  renderMarkdown(project) {
    const lines = ["---"];
    lines.push(`doc_type: ${yamlValue(project.docType || "notice")}`);
    if (project.recipient) lines.push(`recipients: ${yamlValue(project.recipient)}`);
    if (project.issuer) lines.push(`signer: ${yamlValue(project.issuer)}`);
    if (project.date) lines.push(`date: ${yamlValue(project.date)}`);
    lines.push("---", "");
    lines.push(`# ${yamlValue(project.title || "未命名公文")}`, "");
    for (const p of project.paragraphs) {
      const text = String(p.text || "").trim();
      if (!text) continue;
      if (p.role === "title") continue;
      if (p.role === "recipient" || p.role === "signature" || p.role === "date") continue;
      lines.push(text, "");
    }
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }

  writeMarkdown(project) {
    this.ensureProjectDirs(project);
    const file = join(this.projectDir(project), "draft.md");
    writeFileSync(file, this.renderMarkdown(project), "utf8");
    return file;
  }

  draftPath(project) {
    return join(this.projectDir(project), "draft.md");
  }

  addReference(project, reference) {
    this.ensureProjectDirs(project);
    const existing = project.references.find((r) => r.url === reference.url);
    const id = existing?.id || `REF${project.nextRefNo++}`;
    const file = join(this.refsDir(project), `${id}.txt`);
    writeFileSync(file, String(reference.text || ""), "utf8");
    const entry = {
      id,
      title: reference.title || existing?.title || "未命名材料",
      url: reference.url,
      source: reference.source || existing?.source || "",
      savedAt: nowIso(),
      chars: countChars(reference.text || ""),
      excerpt: String(reference.text || "").slice(0, 600),
      file: `refs/${id}.txt`,
    };
    if (existing) Object.assign(existing, entry);
    else project.references.push(entry);
    this.save(project);
    return entry;
  }

  removeReference(project, id) {
    const index = project.references.findIndex((r) => r.id === id);
    if (index < 0) throw new Error(`找不到参考材料 ${id}`);
    const [removed] = project.references.splice(index, 1);
    try {
      const file = join(this.projectDir(project), removed.file || `refs/${removed.id}.txt`);
      if (existsSync(file)) unlinkSync(file);
    } catch {
      // 文件删除失败不影响记录
    }
    this.save(project);
    return removed;
  }

  stats(project) {
    const paragraphs = project.paragraphs;
    const body = paragraphs.filter((p) => isReviewableParagraph(p));
    const headings = paragraphs.filter((p) => isHeadingRole(p.role));
    const chars = paragraphs.reduce((n, p) => n + countChars(p.text), 0);
    const sentences = body.reduce((n, p) => n + splitSentences(p.text).length, 0);
    return {
      paragraphs: paragraphs.length,
      bodyParagraphs: body.length,
      headings: headings.length,
      chars,
      sentences,
      wordTarget: project.wordTarget || 0,
      references: project.references.length,
      revisions: project.revisions.length,
    };
  }

  summary(project, { includeParagraphs = false, includeRevisions = false } = {}) {
    const out = {
      id: project.id,
      title: project.title,
      docType: project.docType,
      docTypeLabel: docTypeLabel(project.docType),
      issuer: project.issuer,
      recipient: project.recipient,
      date: project.date,
      topic: project.topic,
      style: project.style,
      wordTarget: project.wordTarget,
      audience: project.audience,
      speaker: project.speaker,
      speakerRole: project.speakerRole,
      occasion: project.occasion,
      focus: project.focus,
      keyPoints: project.keyPoints,
      mustInclude: project.mustInclude,
      avoid: project.avoid,
      status: project.status,
      outline: project.outline,
      frameCandidates: project.frameCandidates || [],
      frameResearch: project.frameResearch || [],
      selectedFrame: project.selectedFrame || "",
      stats: this.stats(project),
      memory: project.memory,
      preview: project.preview,
      sourcePath: project.sourcePath,
      review: {
        stage: project.review.stage,
        cursor: project.review.cursor,
        startedAt: project.review.startedAt,
        structureSummary: project.review.structureSummary,
        reviewed: Object.keys(project.review.completed || {}).length,
      },
      references: project.references.map((r) => ({
        id: r.id,
        title: r.title,
        source: r.source,
        url: r.url,
        chars: r.chars,
      })),
      projectDir: this.projectDir(project),
      exportsDir: this.exportsDir(project),
      draftMarkdown: this.draftPath(project),
    };
    if (includeParagraphs) {
      out.paragraphs = project.paragraphs.map((p, index) => ({
        index: index + 1,
        id: p.id,
        role: p.role,
        section: p.section || "",
        chars: countChars(p.text),
        text: p.text,
      }));
    }
    if (includeRevisions) {
      out.revisions = project.revisions.slice(-30);
    }
    return out;
  }
}

export function cleanupTempFiles(store) {
  try {
    if (!existsSync(store.tmpDir)) return;
    for (const name of readdirSync(store.tmpDir)) {
      try {
        rmSync(join(store.tmpDir, name), { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}
