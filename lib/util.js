// 公文写作助手 — 通用工具函数
// 与 gongwen-skill 的 Markdown 约定保持兼容：一行一个正文段落，# 为标题。

const PUNCT_END = "。！？；";
const CLOSERS = "”’」』）】〕》";

export function nowIso() {
  return new Date().toISOString();
}

export function uid(prefix = "id") {
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export function projectId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `gw-${stamp}-${Math.random().toString(36).slice(2, 5)}`;
}

export function sanitizeFilePart(input, maxLen = 42) {
  return String(input || "")
    .replace(/[\\/:*?"<>|\r\n\t]/g, "")
    .replace(/\s+/g, "")
    .slice(0, maxLen);
}

export function normalizeParagraphText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t\u3000]+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

/** 保留换行的文本，用于落款单位等需要手工断行的字段。 */
export function normalizeMultilineText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t\u3000]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function countChars(text) {
  return String(text || "").replace(/\s+/g, "").length;
}

export function clampText(text, max) {
  const s = String(text || "");
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…（已截断，共 ${s.length} 字）`;
}

const HEADING_PATTERNS = [
  [/^[一二三四五六七八九十百]+、/, "heading1"],
  [/^（[一二三四五六七八九十百]+）/, "heading2"],
  [/^[0-9]+[.、]/, "heading3"],
  [/^（[0-9]+）/, "heading4"],
];

const SALUTATION_EXCLUDE = /如下|以下|事项|特此|此复|此致|附件|通知如下|报告如下|说明如下|安排如下|要求如下/;

/** 发言稿/函件的称呼，如“各位同学：”“县应急管理局：”，应顶格。 */
export function isSalutationText(text) {
  const t = String(text || "").trim();
  if (!t || t.length > 40) return false;
  if (!/[：:]$/.test(t)) return false;
  const body = t.slice(0, -1);
  if (/[。；]/.test(body)) return false;
  if (SALUTATION_EXCLUDE.test(t)) return false;
  if (/^(?:各位|同志们|朋友们|老师们|同学们|女士们|先生们|来宾们|亲爱的)/.test(t)) return true;
  return /^[\u4e00-\u9fa5A-Za-z0-9（）()、，, ]{2,40}[：:]$/.test(t);
}

export function inferRole(text) {
  const t = String(text || "").trim();
  if (!t) return "body";
  const looksLikeHeading = countChars(t) <= 40 && !/[。；]/.test(t);
  if (looksLikeHeading) {
    for (const [re, role] of HEADING_PATTERNS) {
      if (re.test(t)) return role;
    }
  }
  if (/^附件[：:]/.test(t) || /^附件[0-9一二三四五六七八九十]+[：:]/.test(t)) return "attachment";
  if (isSalutationText(t)) return "salutation";
  return "body";
}

export function isHeadingRole(role) {
  return /^heading[1-4]$/.test(String(role || ""));
}

export function isReviewableParagraph(paragraph) {
  if (!paragraph) return false;
  if (paragraph.reviewable === false) return false;
  if (isHeadingRole(paragraph.role)) return false;
  if (paragraph.role === "recipient" || paragraph.role === "salutation" || paragraph.role === "signature" || paragraph.role === "date") return false;
  return Boolean(String(paragraph.text || "").trim());
}

/**
 * 中文句子切分：保留句末标点与右引号/右括号，偏移量基于原文。
 * @returns {{index:number,start:number,end:number,text:string}[]}
 */
export function splitSentences(text) {
  const s = String(text || "");
  const out = [];
  let start = 0;
  let i = 0;
  const push = (end) => {
    const raw = s.slice(start, end);
    const trimmed = raw.trim();
    if (trimmed) {
      const lead = raw.length - raw.trimStart().length;
      const tail = raw.length - raw.trimEnd().length;
      out.push({
        index: out.length,
        start: start + lead,
        end: end - tail,
        text: trimmed,
      });
    }
    start = end;
  };
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\n") {
      push(i);
      start = i + 1;
      i += 1;
      continue;
    }
    if (PUNCT_END.includes(ch)) {
      let j = i + 1;
      while (j < s.length && PUNCT_END.includes(s[j])) j += 1;
      while (j < s.length && CLOSERS.includes(s[j])) j += 1;
      push(j);
      i = j;
      continue;
    }
    i += 1;
  }
  if (start < s.length) push(s.length);
  return out.filter((x) => x.text);
}

export function decodeEntities(input) {
  const named = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    ldquo: "“",
    rdquo: "”",
    lsquo: "‘",
    rsquo: "’",
    mdash: "—",
    ndash: "–",
    hellip: "…",
    middot: "·",
  };
  return String(input || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => named[name.toLowerCase()] ?? m);
}

function safeChar(code) {
  try {
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  } catch {
    return "";
  }
}

export function stripHtml(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function truncate(text, max) {
  const s = String(text || "");
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
