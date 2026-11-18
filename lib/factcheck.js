// 公文写作助手 — 政治性表述核查
//
// 原则：
// 1. 只把政府机关官网、人民网/共产党员网/新华社等官方来源的正文当作证据；
// 2. 搜索摘要只用于发现线索，不直接作为结论；
// 3. 默认只报告，不自动改写；autoCorrect 只处理“官方原句明确、可精确替换”的硬事实；
// 4. P0 未核实或有冲突的，一律标记为必须人工复核。

import { countChars, truncate, splitSentences } from "./util.js";
import { extractArticle, fetchPage, isOfficialUrl, normalizeOfficialUrl, searchOfficial } from "./research.js";

const CN_DIGITS = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const MEETING_PATTERNS = [
  /中国共产党第?[一二三四五六七八九十百零两\d]+届中央委员会第?[一二三四五六七八九十百零两\d]+次全体会议/g,
  /党的[一二三四五六七八九十百零两\d]+届[一二三四五六七八九十百零两\d]+中全会/g,
  /党的[一二三四五六七八九十百零两\d]+大/g,
  /第[一二三四五六七八九十百零两\d]+届全国人民代表大会第[一二三四五六七八九十百零两\d]+次会议/g,
  /全国政协第?[一二三四五六七八九十百零两\d]+届第?[一二三四五六七八九十百零两\d]+次会议/g,
  /中央纪委第?[一二三四五六七八九十百零两\d]+届第?[一二三四五六七八九十百零两\d]+次全体会议/g,
  /中央(?:经济|农村|城市|政法|外事|民族|宗教|金融|人才|宣传思想文化|统战|网信)工作会议/g,
  /(?:省|市|县|区)委第?[一二三四五六七八九十百零两\d]+届第?[一二三四五六七八九十百零两\d]+次全会/g,
  /(?:主题|党史|党纪)学习教育/g,
];

const FORMULATIONS = [
  "两个确立",
  "两个维护",
  "四个意识",
  "四个自信",
  "四个全面",
  "五位一体",
  "新发展理念",
  "新质生产力",
  "全过程人民民主",
  "中国式现代化",
  "人类命运共同体",
  "全面从严治党",
  "党的自我革命",
  "国之大者",
];

const LEADER_RULES = [
  { name: "习近平", allowed: ["总书记", "国家主席", "中央军委主席", "同志"] },
  { name: "李强", allowed: ["总理", "副总理", "同志"] },
  { name: "赵乐际", allowed: ["委员长", "书记", "同志"] },
  { name: "王沪宁", allowed: ["主席", "书记", "同志"] },
  { name: "蔡奇", allowed: ["书记", "同志"] },
  { name: "丁薛祥", allowed: ["副总理", "主任", "同志"] },
  { name: "李希", allowed: ["书记", "同志"] },
];

const KNOWN_TITLES = new Set(["总书记", "主席", "总理", "委员长", "书记", "副总理", "同志", "主任", "部长"]);

const P0 = "P0";
const P1 = "P1";
const P2 = "P2";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function cnNumber(raw) {
  const s = String(raw || "").trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const ch of s) {
    if (ch === "百") {
      section += (digit || 1) * 100;
      digit = 0;
    } else if (ch === "十") {
      section += (digit || 1) * 10;
      digit = 0;
    } else if (ch in CN_DIGITS) {
      digit = CN_DIGITS[ch];
    }
  }
  return total + section + digit;
}

/** 把会议名称归一成 “届-次” 键，便于识别“二十届三中全会”和全称。 */
export function meetingKey(text) {
  const s = String(text || "").replace(/\s+/g, "");
  let m = /中央纪委第?([一二三四五六七八九十百零两\d]+)届第?([一二三四五六七八九十百零两\d]+)次全体会议/.exec(s);
  if (m) return `ccdi${cnNumber(m[1])}-${cnNumber(m[2])}`;
  m = /(?:省|市|县|区)委第?([一二三四五六七八九十百零两\d]+)届第?([一二三四五六七八九十百零两\d]+)次全会/.exec(s);
  if (m) return `local${cnNumber(m[1])}-${cnNumber(m[2])}`;
  m = /第?([一二三四五六七八九十百零两\d]+)届全国人民代表大会第?([一二三四五六七八九十百零两\d]+)次会议/.exec(s);
  if (m) return `npc${cnNumber(m[1])}-${cnNumber(m[2])}`;
  m = /全国政协第?([一二三四五六七八九十百零两\d]+)届第?([一二三四五六七八九十百零两\d]+)次会议/.exec(s);
  if (m) return `cppcc${cnNumber(m[1])}-${cnNumber(m[2])}`;
  m = /第?([一二三四五六七八九十百零两\d]+)届(?:中央委员会)?第?([一二三四五六七八九十百零两\d]+)次(?:全体会议|全会)/.exec(s);
  if (m) return `p${cnNumber(m[1])}-s${cnNumber(m[2])}`;
  m = /第?([一二三四五六七八九十百零两\d]+)届(?:中央委员会)?([一二三四五六七八九十百零两\d]+)中全会/.exec(s);
  if (m) return `p${cnNumber(m[1])}-s${cnNumber(m[2])}`;
  m = /党的([一二三四五六七八九十百零两\d]+)大/.exec(s);
  if (m) return `d${cnNumber(m[1])}`;
  return "";
}

function meetingRoot(key) {
  const m = /^([a-z]+)(\d+)-/.exec(String(key || ""));
  return m ? `${m[1]}${m[2]}` : String(key || "").split("-")[0];
}

function findMeetings(text) {
  const source = String(text || "");
  const all = [];
  for (const pattern of MEETING_PATTERNS) {
    const re = new RegExp(pattern.source, "g");
    let m;
    while ((m = re.exec(source))) {
      if (!m[0]) continue;
      all.push({ text: m[0], index: m.index, key: meetingKey(m[0]) });
    }
  }
  all.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
  const out = [];
  for (const item of all) {
    if (out.some((prev) => prev.index <= item.index && prev.index + prev.text.length >= item.index + item.text.length)) continue;
    out.push(item);
  }
  return out;
}

function normalizeDate(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function findDates(text) {
  const source = String(text || "");
  const out = [];
  const re = /(20\d{2})年(\d{1,2})月(\d{1,2})日(?:\s*(?:至|到|—|–|－|-|~|～)\s*(?:(\d{1,2})日|(\d{1,2})月(\d{1,2})日))?/g;
  let m;
  while ((m = re.exec(source))) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    let endYear = year;
    let endMonth = month;
    let endDay = day;
    if (m[4]) {
      endDay = Number(m[4]);
    } else if (m[5] && m[6]) {
      endMonth = Number(m[5]);
      endDay = Number(m[6]);
      if (endMonth < month) endYear += 1;
    }
    out.push({
      text: m[0],
      start: normalizeDate(year, month, day),
      end: normalizeDate(endYear, endMonth, endDay),
      startYear: year,
      startMonth: month,
      startDay: day,
      endYear,
      endMonth,
      endDay,
      index: m.index,
    });
  }
  // 只有年月的表述，单独记一条低置信度日期。
  const monthRe = /(20\d{2})年(\d{1,2})月(?!\s*\d{1,2}日)/g;
  while ((m = monthRe.exec(source))) {
    const text = m[0];
    if (out.some((d) => d.index <= m.index && d.index + d.text.length >= m.index + text.length)) continue;
    out.push({
      text,
      start: `${m[1]}-${pad2(Number(m[2]))}`,
      end: `${m[1]}-${pad2(Number(m[2]))}`,
      startYear: Number(m[1]),
      startMonth: Number(m[2]),
      startDay: 0,
      endYear: Number(m[1]),
      endMonth: Number(m[2]),
      endDay: 0,
      index: m.index,
      monthOnly: true,
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

function findMonthDays(text) {
  const source = String(text || "");
  const out = [];
  const re = /(\d{1,2})月(\d{1,2})日(?:\s*(?:至|到|—|–|－|-|~|～)\s*(?:(\d{1,2})日|(\d{1,2})月(\d{1,2})日))?/g;
  let m;
  while ((m = re.exec(source))) {
    const prefix = source.slice(Math.max(0, m.index - 6), m.index);
    if (/20\d{2}年$/.test(prefix)) continue;
    const month = Number(m[1]);
    const day = Number(m[2]);
    let endMonth = month;
    let endDay = day;
    if (m[3]) endDay = Number(m[3]);
    else if (m[4] && m[5]) {
      endMonth = Number(m[4]);
      endDay = Number(m[5]);
    }
    out.push({
      text: m[0],
      start: `??-${pad2(month)}-${pad2(day)}`,
      end: `??-${pad2(endMonth)}-${pad2(endDay)}`,
      startMonth: month,
      startDay: day,
      endMonth,
      endDay,
      index: m.index,
      monthDayOnly: true,
    });
  }
  return out;
}

function sameDate(a, b) {
  if (!a || !b) return false;
  return a.start === b.start && a.end === b.end;
}

function dateOverlap(a, b) {
  if (!a || !b) return false;
  const aStart = a.start || "";
  const bStart = b.start || "";
  if (!aStart || !bStart) return false;
  return aStart === bStart || (a.end && b.start && a.start <= b.end && b.start <= a.end);
}

/**
 * exact：完全一致；start：原文只写开幕日，官方给了会期；
 * partial：只部分重叠/只有月份；空字符串：不一致。
 */
function dateMatch(claimDate, officialDate) {
  if (!claimDate || !officialDate) return "";
  if (claimDate.monthDayOnly) {
    if (!officialDate.start || officialDate.start.startsWith("??")) return "";
    const claimStart = claimDate.start.slice(3);
    const claimEnd = claimDate.end.slice(3);
    const officialStart = officialDate.start.slice(5);
    const officialEnd = officialDate.end.slice(5);
    return claimStart === officialStart && claimEnd === officialEnd ? "partial" : "";
  }
  if (sameDate(claimDate, officialDate)) return "exact";
  if (claimDate.monthOnly || officialDate.monthOnly) return dateOverlap(claimDate, officialDate) ? "partial" : "";
  if (claimDate.start === officialDate.start) {
    if (claimDate.end === claimDate.start) return "start";
    if (officialDate.end === officialDate.start) return "partial";
  }
  return dateOverlap(claimDate, officialDate) ? "partial" : "";
}

function normalizePhrase(text) {
  return String(text || "")
    .replace(/[“”"'‘’]/g, "")
    .replace(/[\s\u3000]+/g, "")
    .replace(/[，。；：、,.;:]/g, "");
}

function quote(text, max = 320) {
  return truncate(String(text || "").replace(/\s+/g, " ").trim(), max);
}

function findLeaderMismatches(text) {
  const s = String(text || "");
  const out = [];
  for (const rule of LEADER_RULES) {
    const re = new RegExp(`${rule.name}([\\u4e00-\\u9fa5]{1,4})`, "g");
    let m;
    while ((m = re.exec(s))) {
      const title = m[1];
      if (!KNOWN_TITLES.has(title)) continue;
      if (rule.allowed.includes(title)) continue;
      out.push({ name: rule.name, title, text: m[0], index: m.index });
    }
  }
  if (/习总书记/.test(s)) {
    out.push({ name: "习近平", title: "总书记", text: "习总书记", index: s.indexOf("习总书记"), informal: true });
  }
  return out;
}

const DOC_PREFIXES = [
  "中办发电",
  "国办发明电",
  "中办发",
  "国办发",
  "中组发",
  "中宣发",
  "中政法",
  "中网发",
  "中编办发",
  "中纪发",
  "国办函",
  "国函",
  "厅字",
  "中发",
  "国发",
  "发改",
  "自然资",
  "生态",
  "应急",
  "卫健",
  "医保",
  "人社",
  "民政",
  "司法",
  "教育",
  "科技",
  "工信",
  "交通",
  "水利",
  "农业",
  "农村",
  "林草",
  "能源",
  "烟草",
  "邮政",
  "铁路",
  "民航",
  "海关",
  "税总",
  "市监",
  "知识产权",
  "药监",
  "中医药",
  "文旅",
  "文物",
  "广电",
  "体育",
  "气象",
  "地震",
  "海洋",
  "测绘",
  "档案",
  "保密",
  "信访",
  "储备",
  "移民",
  "乡村振兴",
  "供销",
  "工会",
  "共青团",
  "妇联",
  "残联",
  "侨联",
  "贸促",
].sort((a, b) => b.length - a.length);

const DOC_PREFIX_RE = DOC_PREFIXES.join("|");

function findDocumentNumbers(text) {
  const out = [];
  const re = new RegExp(`((?:${DOC_PREFIX_RE})?〔20\\d{2}〕\\d+号)`, "g");
  let m;
  while ((m = re.exec(String(text || "")))) {
    const full = m[1];
    const year = /〔(20\d{2})〕/.exec(full)?.[1] || "";
    const no = /〕(\d+)号/.exec(full)?.[1] || "";
    out.push({ text: full, index: m.index, year, no });
  }
  return out;
}

function pushClaim(list, claim) {
  const key = `${claim.kind}|${claim.subject}|${claim.assertedDate?.start || ""}|${claim.sentenceIndex}|${claim.paragraphId || ""}`;
  if (list.some((x) => x._key === key)) return;
  list.push({ ...claim, _key: key });
}

function riskRank(risk) {
  return risk === P0 ? 0 : risk === P1 ? 1 : 2;
}

function kindLabel(kind) {
  return (
    {
      meeting_date: "会议时间",
      meeting_name: "会议名称",
      spirit: "会议精神/重要讲话",
      formulation: "重要提法",
      document_number: "文件号",
      leader_title: "领导人职务",
      relative_time: "相对时间",
    }[kind] || kind
  );
}

function claimReason(kind) {
  return (
    {
      meeting_date: "会议时间、会期和地点属于政治性硬事实，必须与官方报道逐字核对。",
      meeting_name: "会议名称、届次不能有误，必须核对官方全称。",
      spirit: "会议精神、重要讲话和重要指示的表述必须使用官方口径。",
      formulation: "重要提法有固定表述，不能随意增减或改写。",
      document_number: "文件编号属于硬事实，必须与官方文件一致。",
      leader_title: "领导人姓名和职务必须准确，不能混用。",
      relative_time: "“今年/去年/近日”等相对时间会随发文时间变化，必须改为明确时间或核实。",
    }[kind] || "政治性表述需要官方来源核对。"
  );
}

/** 从项目或一段文字中提取需要核查的政治性表述。 */
export function extractClaims({ project, text } = {}, { maxClaims = 50 } = {}) {
  const paragraphs = project
    ? (project.paragraphs || []).map((p, index) => ({
        id: p.id,
        index,
        text: String(p.text || ""),
      }))
    : [{ id: "", index: 0, text: String(text || "") }];
  const claims = [];
  let sentenceCount = 0;

  for (const paragraph of paragraphs) {
    if (!paragraph.text.trim()) continue;
    const sentences = splitSentences(paragraph.text);
    sentenceCount += sentences.length;
    for (const sentence of sentences) {
      const s = sentence.text;
      const meetings = findMeetings(s);
      const dates = findDates(s);
      const monthDays = dates.length ? [] : findMonthDays(s);
      const hasSpirit = /精神|重要讲话|重要指示|重要论述/.test(s);
      const relative = /去年|今年|明年|日前|近日|近期|上半年|下半年/.test(s);

      for (const meeting of meetings) {
        const date = dates[0] || monthDays[0] || null;
        const base = {
          paragraphId: paragraph.id,
          paragraphIndex: paragraph.index,
          paragraphText: paragraph.text,
          sentenceIndex: sentence.index,
          sentenceText: s,
          sentenceStart: sentence.start,
          sentenceEnd: sentence.end,
          subject: meeting.text,
          meetingKey: meeting.key,
        };
        if (date) {
          pushClaim(claims, {
            ...base,
            kind: "meeting_date",
            risk: P0,
            assertedDate: date,
            reason: date.monthDayOnly
              ? "会议时间只写了月日、没有年份，必须补全年份并与官方会期核对。"
              : claimReason("meeting_date"),
          });
        } else {
          pushClaim(claims, {
            ...base,
            kind: "meeting_name",
            risk: P1,
            assertedDate: null,
            reason: claimReason("meeting_name"),
          });
        }
        if (hasSpirit) {
          pushClaim(claims, {
            ...base,
            kind: "spirit",
            risk: P1,
            subject: `${meeting.text}精神`,
            assertedDate: null,
            reason: claimReason("spirit"),
          });
        }
        if (relative) {
          pushClaim(claims, {
            ...base,
            kind: "relative_time",
            risk: P1,
            subject: meeting.text,
            assertedDate: null,
            reason: claimReason("relative_time"),
          });
        }
      }

      if (!meetings.length && hasSpirit && /习近平总书记|党中央|国务院/.test(s)) {
        const subject = /习近平总书记/.test(s)
          ? /重要指示/.test(s)
            ? "习近平总书记重要指示精神"
            : /重要论述/.test(s)
              ? "习近平总书记重要论述"
              : "习近平总书记重要讲话精神"
          : /党中央/.test(s)
            ? "党中央决策部署"
            : "国务院部署";
        pushClaim(claims, {
          paragraphId: paragraph.id,
          paragraphIndex: paragraph.index,
          paragraphText: paragraph.text,
          sentenceIndex: sentence.index,
          sentenceText: s,
          sentenceStart: sentence.start,
          sentenceEnd: sentence.end,
          kind: "spirit",
          risk: P1,
          subject,
          assertedDate: null,
          reason: claimReason("spirit"),
        });
      }

      for (const term of FORMULATIONS) {
        if (!s.includes(term)) continue;
        pushClaim(claims, {
          paragraphId: paragraph.id,
          paragraphIndex: paragraph.index,
          paragraphText: paragraph.text,
          sentenceIndex: sentence.index,
          sentenceText: s,
          sentenceStart: sentence.start,
          sentenceEnd: sentence.end,
          kind: "formulation",
          risk: P1,
          subject: term,
          assertedDate: null,
          reason: claimReason("formulation"),
        });
      }

      for (const doc of findDocumentNumbers(s)) {
        pushClaim(claims, {
          paragraphId: paragraph.id,
          paragraphIndex: paragraph.index,
          paragraphText: paragraph.text,
          sentenceIndex: sentence.index,
          sentenceText: s,
          sentenceStart: sentence.start,
          sentenceEnd: sentence.end,
          kind: "document_number",
          risk: P0,
          subject: doc.text,
          assertedDate: null,
          reason: claimReason("document_number"),
        });
      }

      for (const leader of findLeaderMismatches(s)) {
        pushClaim(claims, {
          paragraphId: paragraph.id,
          paragraphIndex: paragraph.index,
          paragraphText: paragraph.text,
          sentenceIndex: sentence.index,
          sentenceText: s,
          sentenceStart: sentence.start,
          sentenceEnd: sentence.end,
          kind: "leader_title",
          risk: P0,
          subject: leader.text,
          expected: `${leader.name}${leader.allowed?.[0] || ""}`,
          assertedDate: null,
          reason: claimReason("leader_title"),
        });
      }
    }
  }

  const unique = [];
  const seen = new Set();
  for (const claim of claims) {
    if (seen.has(claim._key)) continue;
    seen.add(claim._key);
    delete claim._key;
    unique.push(claim);
  }
  unique.sort((a, b) => riskRank(a.risk) - riskRank(b.risk) || a.paragraphIndex - b.paragraphIndex || a.sentenceIndex - b.sentenceIndex);
  const limited = unique.slice(0, Math.max(1, Math.min(50, Number(maxClaims) || 50)));
  limited.forEach((claim, i) => {
    claim.id = `C${i + 1}`;
    claim.kindLabel = kindLabel(claim.kind);
    claim.query = buildQueries(claim)[0] || "";
    claim.riskLabel = claim.risk === P0 ? "政治性硬事实" : claim.risk === P1 ? "重要提法" : "一般表述";
  });
  return {
    sentences: sentenceCount,
    total: unique.length,
    claims: limited,
    truncated: unique.length > limited.length,
    summary: {
      p0: unique.filter((x) => x.risk === P0).length,
      p1: unique.filter((x) => x.risk === P1).length,
      p2: unique.filter((x) => x.risk === P2).length,
    },
  };
}

function queryQuote(text) {
  return `"${String(text || "").replace(/["“”]/g, "").trim()}"`;
}

export function buildQueries(claim) {
  const subject = String(claim.subject || "").trim();
  const dateText = claim.assertedDate?.text || "";
  const q = [];
  if (!subject) return q;
  if (claim.kind === "meeting_date") {
    q.push(`${queryQuote(subject)} ${queryQuote(dateText)} site:gov.cn`);
    q.push(`${queryQuote(subject)} 举行 site:gov.cn`);
    q.push(`${queryQuote(subject)} site:people.com.cn`);
    q.push(`${queryQuote(subject)} site:12371.cn`);
  } else if (claim.kind === "meeting_name") {
    q.push(`${queryQuote(subject)} site:gov.cn`);
    q.push(`${queryQuote(subject)} site:people.com.cn`);
  } else if (claim.kind === "spirit") {
    q.push(`${queryQuote(subject)} site:gov.cn`);
    q.push(`${queryQuote(subject)} site:people.com.cn`);
  } else if (claim.kind === "formulation") {
    q.push(`${queryQuote(subject)} site:gov.cn`);
    q.push(`${queryQuote(subject)} site:people.com.cn`);
  } else if (claim.kind === "document_number") {
    q.push(`${queryQuote(subject)} site:gov.cn`);
  } else if (claim.kind === "leader_title") {
    q.push(`${queryQuote(subject)} site:gov.cn`);
    q.push(`${queryQuote(subject)} site:people.com.cn`);
  } else if (claim.kind === "relative_time") {
    q.push(`${queryQuote(subject)} 时间 site:gov.cn`);
  }
  return [...new Set(q)].slice(0, 3);
}

function sourceLabel(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "gov.cn" || host.endsWith(".gov.cn")) return "政府网站";
    if (host.endsWith("people.com.cn")) return "人民网";
    if (host.endsWith("12371.cn")) return "共产党员网";
    if (host.endsWith("news.cn") || host.endsWith("xinhuanet.com")) return "新华社";
    if (host.endsWith("qstheory.cn")) return "求是网";
    if (host.endsWith("cctv.com")) return "央视网";
    if (host.endsWith("dangjian.cn")) return "党建网";
    if (host.endsWith("qizhiwang.org.cn")) return "旗帜网";
    if (host.endsWith("rmlt.com.cn")) return "人民论坛网";
    if (host.endsWith("chinanews.com.cn")) return "中国新闻网";
    if (host === "mp.weixin.qq.com") return "微信公众号";
    return "官方网站";
  } catch {
    return "官方网站";
  }
}

function authorityOf(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "gov.cn" || host.endsWith(".gov.cn")) return 5;
    if (host.endsWith("people.com.cn") || host.endsWith("12371.cn")) return 4;
    if (host.endsWith("news.cn") || host.endsWith("xinhuanet.com") || host.endsWith("qstheory.cn") || host.endsWith("cctv.com")) return 4;
    if (host.endsWith("dangjian.cn") || host.endsWith("qizhiwang.org.cn") || host.endsWith("rmlt.com.cn") || host.endsWith("chinanews.com.cn")) return 3;
    return 2;
  } catch {
    return 0;
  }
}

function cleanUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return String(url || "");
  }
}

function scoreSource(source, claim) {
  let score = authorityOf(source.url) * 2;
  const title = String(source.title || "");
  const snippet = String(source.snippet || source.summary || "");
  if (title.includes(claim.subject)) score += 5;
  if (claim.assertedDate?.text && `${title} ${snippet}`.includes(claim.assertedDate.text)) score += 4;
  if (claim.kind === "meeting_date" && /全会|会议|举行|召开/.test(title)) score += 2;
  if (source.publishedAt) score += 1;
  return score;
}

async function discoverSources(claim, { web, signal, maxResults = 8 } = {}) {
  const queries = buildQueries(claim);
  const found = [];
  const errors = [];
  for (const query of queries) {
    try {
      if (web?.search) {
        const result = await web.search({ query, maxResults }, signal);
        for (const source of result?.sources || []) found.push({ ...source, query });
      } else {
        const result = await searchOfficial({ query, sources: ["gov", "people", "12371", "dangjian", "qizhiwang"], maxResults: 6, signal });
        for (const source of result?.results || []) found.push({ ...source, query });
      }
    } catch (error) {
      errors.push({ query, error: String(error?.message || error) });
    }
  }
  const seen = new Set();
  const official = [];
  for (const source of found) {
    if (!source?.url || !isOfficialUrl(source.url)) continue;
    const url = cleanUrl(source.url);
    if (seen.has(url)) continue;
    seen.add(url);
    official.push({ ...source, url, source: sourceLabel(url) });
  }
  official.sort((a, b) => scoreSource(b, claim) - scoreSource(a, claim));
  return { sources: official.slice(0, Math.max(1, maxResults)), errors };
}

/** 每条 query 至少取一条，避免“精确日期”查询把能纠错的宽泛查询结果挤掉。 */
function pickDiverseSources(sources, limit) {
  const groups = new Map();
  for (const source of sources) {
    const key = source.query || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(source);
  }
  const out = [];
  let round = 0;
  while (out.length < limit) {
    let added = false;
    for (const list of groups.values()) {
      const item = list[round];
      if (!item) continue;
      if (!out.includes(item)) {
        out.push(item);
        added = true;
      }
      if (out.length >= limit) break;
    }
    if (!added) break;
    round += 1;
  }
  for (const source of sources) {
    if (out.length >= limit) break;
    if (!out.includes(source)) out.push(source);
  }
  return out;
}

async function fetchArticleForSource(source, { web, signal } = {}) {
  if (web?.fetch) {
    try {
      const result = await web.fetch({ url: source.url }, signal);
      if (result?.statusCode >= 200 && result.statusCode < 300 && result.body?.content) {
        const finalUrl = result.url || source.url;
        if (!isOfficialUrl(finalUrl)) throw new Error("页面跳转到了非官方网站，已拒绝作为证据。");
        let article;
        if (result.body.kind === "html") {
          article = extractArticle(result.body.content, finalUrl);
        } else {
          article = {
            title: source.title || "",
            text: String(result.body.content || ""),
            date: source.publishedAt || "",
            url: finalUrl,
            chars: String(result.body.content || "").length,
          };
        }
        // web.fetch 有时只返回搜索摘要或标题，正文过短时改用直连抓取。
        if (countChars(article.text) >= 200) {
          return { ...article, title: article.title || source.title || "", url: finalUrl };
        }
      }
    } catch {
      // fall through to direct fetch
    }
  }
  const page = await fetchPage(normalizeOfficialUrl(source.url), { signal });
  const finalUrl = page.url || source.url;
  if (!isOfficialUrl(finalUrl)) throw new Error("页面跳转到了非官方网站，已拒绝作为证据。");
  const article = extractArticle(page.html, finalUrl);
  return { ...article, title: article.title || source.title || "", url: finalUrl };
}

function subjectAliases(claim) {
  const text = String(claim.subject || "");
  const aliases = new Set([text]);
  if (text.startsWith("党的")) aliases.add(text.slice(2));
  if (text.startsWith("中国共产党")) aliases.add(text.replace(/^中国共产党/, ""));
  if (text.includes("中央委员会")) aliases.add(text.replace(/中央委员会/, ""));
  const key = meetingKey(text);
  if (key.startsWith("p")) {
    // 二十届三中全会：同时尝试去掉“党”的短称。
    const m = /^p(\d+)-s(\d+)$/.exec(key);
    if (m) aliases.add(`${toChinese(Number(m[1]))}届${toChinese(Number(m[2]))}中全会`);
  }
  return [...aliases].filter(Boolean);
}

function toChinese(n) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (n < 10) return digits[n];
  if (n < 20) return `十${n % 10 ? digits[n % 10] : ""}`;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${digits[tens]}十${ones ? digits[ones] : ""}`;
}

function sentenceHasMeeting(sentence, claim) {
  const key = meetingKey(claim.subject);
  if (key) {
    const sentenceKey = meetingKey(sentence);
    if (sentenceKey) return sentenceKey === key;
  }
  return subjectAliases(claim).some((alias) => sentence.includes(alias));
}

function findMeetingSentence(text, claim) {
  const sentences = splitSentences(text);
  return sentences.find((s) => sentenceHasMeeting(s.text, claim)) || null;
}

function findDateInWindow(text, claim) {
  const sentences = splitSentences(text);
  const meetingIndexes = sentences.map((s, i) => (sentenceHasMeeting(s.text, claim) ? i : -1)).filter((i) => i >= 0);
  if (!meetingIndexes.length) return null;

  // 全篇找日期，按“与原文会期的吻合程度”优先，再按离会议名称的远近排序。
  // 不能只看相邻两句：官方页面可能在标题/电头之后才写会期。
  const candidates = [];
  for (let i = 0; i < sentences.length; i += 1) {
    const dates = findDates(sentences[i].text);
    if (!dates.length) continue;
    const distance = Math.min(...meetingIndexes.map((idx) => Math.abs(idx - i)));
    const meetingHere = sentenceHasMeeting(sentences[i].text, claim);
    const eventWord = /举行|召开|开幕|闭幕/.test(sentences[i].text);
    const contextRank = meetingHere && eventWord ? 0 : meetingHere ? 1 : eventWord ? 2 : 3;
    for (const date of dates) {
      const level = dateMatch(claim.assertedDate, date);
      const rank = level === "exact" ? 0 : level === "start" ? 1 : level === "partial" ? 2 : 3;
      candidates.push({ sentence: sentences[i], dates: [date], distance, rank, contextRank });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.rank - b.rank || a.contextRank - b.contextRank || a.distance - b.distance);
  return { sentence: candidates[0].sentence, dates: candidates[0].dates };
}

function evidenceForMeetingDate(claim, article) {
  const text = String(article.text || "");
  if (!text) return null;
  const meetingSentence = findMeetingSentence(text, claim);
  if (!meetingSentence) return null;
  const ownDates = findDates(meetingSentence.text);
  let sentence = meetingSentence;
  let dates = ownDates;
  if (!dates.length) {
    const window = findDateInWindow(text, claim);
    if (window) {
      sentence = window.sentence;
      dates = window.dates;
    }
  }
  if (!dates.length) {
    return {
      match: false,
      partial: true,
      quote: quote(meetingSentence.text),
      article,
      alternative: null,
      reason: "官方页面出现了会议名称，但未提取到会期。",
    };
  }
  // 只有“会议于×月×日举行/召开”这类语境才能确认会期；
  // 公报落款日期、文件通过日期不能当成会议召开日期。
  if (!/举行|召开|开幕|闭幕/.test(sentence.text)) {
    return {
      match: false,
      partial: true,
      quote: quote(sentence.text),
      article,
      alternative: dates[0],
      reason: "官方页面有日期，但不在会议举行/召开的语境中，需人工确认。",
    };
  }
  let match = null;
  let partial = null;
  for (const d of dates) {
    const level = dateMatch(claim.assertedDate, d);
    if (level === "exact" || level === "start") {
      match = d;
      break;
    }
    if (level === "partial" && !partial) partial = d;
  }
  const alternative = match ? null : partial || dates[0];
  return {
    match: Boolean(match),
    partial: Boolean(partial && !match),
    quote: quote(sentence.text),
    article,
    alternative,
    matchedDate: match || null,
    reason: match
      ? "官方页面会期与原文一致。"
      : partial
        ? `官方页面会期为“${partial.text}”，与原文部分重合，需人工确认。`
        : `官方页面会期为“${alternative?.text || ""}”。`,
  };
}

function evidenceForMeetingName(claim, article) {
  const text = String(article.text || "");
  const sentence = findMeetingSentence(text, claim);
  if (sentence) {
    return { match: true, quote: quote(sentence.text), article, alternative: null, reason: "官方页面出现同一会议名称。" };
  }
  const found = findMeetings(text);
  const claimKey = meetingKey(claim.subject);
  const near = found.find((m) => claimKey && meetingKey(m.text) && meetingRoot(meetingKey(m.text)) === meetingRoot(claimKey) && meetingKey(m.text) !== claimKey);
  if (near) {
    return {
      match: false,
      quote: quote(text.slice(Math.max(0, near.index - 80), near.index + near.text.length + 120)),
      article,
      alternative: { text: near.text, subject: near.text },
      reason: `官方页面出现的是“${near.text}”。`,
    };
  }
  return null;
}

function evidenceForSpirit(claim, article) {
  const text = String(article.text || "");
  const needle = normalizePhrase(claim.subject);
  if (!needle) return null;
  const sentences = splitSentences(text);
  const hit = sentences.find((s) => normalizePhrase(s.text).includes(needle));
  if (hit) return { match: true, quote: quote(hit.text), article, alternative: null, reason: "官方页面出现相同提法。" };
  const stem = needle.replace(/精神$/, "");
  if (stem.length >= 6) {
    const stemHit = sentences.find((s) => normalizePhrase(s.text).includes(stem) && /精神|讲话|指示/.test(s.text));
    if (stemHit) return { match: true, quote: quote(stemHit.text), article, alternative: null, reason: "官方页面出现同一会议/讲话精神表述。" };
  }
  return null;
}

function evidenceForFormulation(claim, article) {
  const text = String(article.text || "");
  const needle = normalizePhrase(claim.subject);
  if (!needle) return null;
  const sentences = splitSentences(text);
  const hit = sentences.find((s) => normalizePhrase(s.text).includes(needle));
  if (hit) return { match: true, quote: quote(hit.text), article, alternative: null, reason: "官方页面出现同一提法。" };
  return null;
}

function evidenceForDocument(claim, article) {
  const text = String(article.text || "");
  const needle = normalizePhrase(claim.subject);
  if (!needle) return null;
  const sentences = splitSentences(text);
  const hit = sentences.find((s) => normalizePhrase(s.text).includes(needle));
  if (hit) return { match: true, quote: quote(hit.text), article, alternative: null, reason: "官方页面出现同一文件号。" };
  return null;
}

function evidenceForLeader(claim, article) {
  const text = String(article.text || "");
  const sentences = splitSentences(text);
  const hit = sentences.find((s) => s.text.includes(claim.subject));
  if (hit) return { match: true, quote: quote(hit.text), article, alternative: null, reason: "官方页面出现同一姓名和职务。" };
  if (claim.subject === "习总书记") {
    const official = sentences.find((s) => s.text.includes("习近平总书记"));
    if (official) {
      return {
        match: false,
        quote: quote(official.text),
        article,
        alternative: { text: "习近平总书记", subject: "习近平总书记" },
        reason: "官方规范表述为“习近平总书记”，不宜简称“习总书记”。",
      };
    }
  }
  const name = claim.subject.replace(/(总书记|主席|总理|委员长|书记|副总理|同志)$/, "");
  const other = sentences.find((s) => s.text.includes(name) && new RegExp(`${name}(总书记|主席|总理|委员长|书记|副总理|同志)`).test(s.text));
  if (other) {
    const m = new RegExp(`${name}(总书记|主席|总理|委员长|书记|副总理|同志)`).exec(other.text);
    return {
      match: false,
      quote: quote(other.text),
      article,
      alternative: { text: `${name}${m[1]}`, subject: `${name}${m[1]}` },
      reason: `官方页面写的是“${name}${m[1]}”。`,
    };
  }
  return null;
}

function evidenceForClaim(claim, article) {
  if (claim.kind === "meeting_date") return evidenceForMeetingDate(claim, article);
  if (claim.kind === "meeting_name") return evidenceForMeetingName(claim, article);
  if (claim.kind === "spirit") return evidenceForSpirit(claim, article);
  if (claim.kind === "formulation") return evidenceForFormulation(claim, article);
  if (claim.kind === "document_number") return evidenceForDocument(claim, article);
  if (claim.kind === "leader_title") return evidenceForLeader(claim, article);
  if (claim.kind === "relative_time") return evidenceForMeetingName(claim, article);
  return null;
}

function makeCorrection(claim, verdict) {
  if (verdict.verdict !== "conflict" || !verdict.alternative) return null;
  const alt = verdict.alternative;
  if (claim.kind === "meeting_date" && alt.text) {
    const at = claim.sentenceText.indexOf(claim.assertedDate?.text || "");
    if (at < 0) return null;
    const suggestion = claim.sentenceText.replace(claim.assertedDate.text, alt.text);
    return {
      text: suggestion,
      from: claim.sentenceStart + at,
      to: claim.sentenceStart + at + (claim.assertedDate?.text || "").length,
      replacement: alt.text,
      safe: authorityOf(verdict.official?.[0]?.url || "") >= 4,
      note: `官方会期为“${alt.text}”`,
    };
  }
  if (claim.kind === "document_number" && alt.text) {
    const at = claim.sentenceText.indexOf(claim.subject);
    if (at < 0) return null;
    return {
      text: claim.sentenceText.replace(claim.subject, alt.text),
      from: claim.sentenceStart + at,
      to: claim.sentenceStart + at + claim.subject.length,
      replacement: alt.text,
      safe: authorityOf(verdict.official?.[0]?.url || "") >= 4,
      note: `官方文件号为“${alt.text}”`,
    };
  }
  if (claim.kind === "leader_title" && alt.text) {
    const at = claim.sentenceText.indexOf(claim.subject);
    if (at < 0) return null;
    return {
      text: claim.sentenceText.replace(claim.subject, alt.text),
      from: claim.sentenceStart + at,
      to: claim.sentenceStart + at + claim.subject.length,
      replacement: alt.text,
      // 领导人职务涉及具体场合（党内/国家/外事），不自动改，只给建议。
      safe: false,
      note: `官方表述为“${alt.text}”，请结合语境人工确认`,
    };
  }
  return null;
}

function finalizeVerdict(claim, evaluations) {
  const matches = evaluations.filter((e) => e.match);
  const conflicts = evaluations.filter((e) => !e.match && !e.partial && e.alternative);
  const partials = evaluations.filter((e) => e.partial);
  let official = evaluations
    .filter((e) => e.match || e.alternative)
    .slice()
    .sort((a, b) => authorityOf(b.article?.url || "") - authorityOf(a.article?.url || ""))
    .slice(0, 3)
    .map((e) => ({
      title: e.article?.title || "",
      url: e.article?.url || "",
      source: e.article?.sourceLabel || sourceLabel(e.article?.url || ""),
      quote: e.quote || "",
      date: e.article?.date || "",
      match: Boolean(e.match),
    }));

  let verdict = "unverified";
  let confidence = "low";
  let alternative = null;
  let finding = "未在官方页面找到可直接核对的原文，需人工查证。";
  if (matches.length) {
    const best = matches.sort((a, b) => authorityOf(b.article?.url || "") - authorityOf(a.article?.url || ""))[0];
    verdict = "verified";
    confidence = authorityOf(best.article?.url || "") >= 4 ? "high" : "medium";
    finding = best.reason || "官方页面与原文一致。";
  } else if (conflicts.length) {
    const best = conflicts.sort((a, b) => authorityOf(b.article?.url || "") - authorityOf(a.article?.url || ""))[0];
    const authorities = new Set(conflicts.map((e) => authorityOf(e.article?.url || "")));
    if (authorities.size > 1 || conflicts.length > 1) {
      verdict = "needs_review";
      finding = "多个官方页面出现不同表述，需人工比对。";
    } else {
      verdict = "conflict";
      confidence = authorityOf(best.article?.url || "") >= 4 ? "high" : "medium";
      finding = best.reason || "官方表述与原文不一致。";
    }
    alternative = best.alternative;
  } else if (partials.length) {
    verdict = "needs_review";
    finding = "官方页面提到了同一会议，但未能提取到完整会期，需人工确认。";
  }

  if (verdict === "verified") {
    const matched = official.filter((x) => x.match);
    if (matched.length) official = matched;
  }

  const result = {
    verdict,
    confidence,
    finding,
    official,
    alternative,
    needsHuman: claim.risk === P0 && verdict !== "verified",
  };
  result.correction = makeCorrection(claim, result);
  if (result.correction && !result.correction.safe) result.correction.safe = false;
  return result;
}

/** 用一篇已经抓取/核验过的文章正文核对一条表述。 */
export function verifyClaimAgainstArticle(claim, article, { label = "" } = {}) {
  const evaluation = evidenceForClaim(claim, article);
  const verdict = finalizeVerdict(claim, evaluation ? [evaluation] : []);
  return {
    ...claim,
    ...verdict,
    official: verdict.official.map((x) => ({ ...x, quote: quote(x.quote, 240) })),
    searchQueries: [label || `verify:${article.url || ""}`],
    searchErrors: [],
    fetchErrors: [],
  };
}

/** 用一篇指定的官方页面核对一条表述（供人工指定链接时使用）。 */
export async function verifyClaimAtUrl(claim, url, { web, signal } = {}) {
  if (!isOfficialUrl(url)) throw new Error("只接受政府机关官网或人民网、共产党员网、新华社等官方链接。");
  const article = await fetchArticleForSource({ url, title: "" }, { web, signal });
  return verifyClaimAgainstArticle(claim, article);
}

/** 逐条检索官方来源并给出“已核实/冲突/未核实/需人工”的结论。 */
export async function checkClaims(claims, { web, signal, maxSources = 3, maxResults = 8 } = {}) {
  const checked = [];
  for (const claim of claims) {
    const { sources, errors } = await discoverSources(claim, { web, signal, maxResults });
    const evaluations = [];
    const fetchErrors = [];
    const limit = Math.max(1, Math.min(6, Number(maxSources) || 3));
    const fetched = new Set();
    const fetchInto = async (list) => {
      for (const source of list) {
        if (fetched.has(source.url)) continue;
        fetched.add(source.url);
        try {
          const article = await fetchArticleForSource(source, { web, signal });
          const evaluation = evidenceForClaim(claim, article);
          if (evaluation) evaluations.push(evaluation);
        } catch (error) {
          fetchErrors.push({ url: source.url, error: String(error?.message || error) });
        }
      }
    };

    await fetchInto(pickDiverseSources(sources, limit));
    let verdict = finalizeVerdict(claim, evaluations);
    // 首轮没有定论（或出现冲突）时，再补抓两个来源交叉验证，避免单页误判。
    if (verdict.verdict !== "verified") {
      const extra = sources.filter((s) => !fetched.has(s.url)).slice(0, 2);
      if (extra.length) {
        await fetchInto(extra);
        verdict = finalizeVerdict(claim, evaluations);
      }
    }
    checked.push({
      ...claim,
      ...verdict,
      official: verdict.official.map((x) => ({ ...x, quote: quote(x.quote, 240) })),
      searchQueries: buildQueries(claim),
      searchErrors: errors,
      fetchErrors,
    });
  }
  return checked;
}

function statusIcon(verdict) {
  return { verified: "✓ 已核实", conflict: "✗ 存在冲突", unverified: "？未核实", needs_review: "！需人工复核" }[verdict] || "？未核实";
}

/** 生成可读的 Markdown 核查报告。 */
export function buildFactReport(checked, { project, checkedAt } = {}) {
  const summary = {
    total: checked.length,
    p0: checked.filter((x) => x.risk === P0).length,
    p1: checked.filter((x) => x.risk === P1).length,
    verified: checked.filter((x) => x.verdict === "verified").length,
    conflict: checked.filter((x) => x.verdict === "conflict").length,
    unverified: checked.filter((x) => x.verdict === "unverified").length,
    needsReview: checked.filter((x) => x.verdict === "needs_review").length,
  };
  const lines = [
    "# 政治性表述核查报告",
    "",
    `- 核查时间：${checkedAt || new Date().toISOString()}`,
    project ? `- 文件：${project.title || project.id}` : "- 文件：临时文本",
    `- 共核查 ${summary.total} 条：P0 ${summary.p0} 条、P1 ${summary.p1} 条；已核实 ${summary.verified} 条、冲突 ${summary.conflict} 条、未核实 ${summary.unverified} 条、需人工 ${summary.needsReview} 条。`,
    "",
    "> 仅采用政府机关官网及人民网、共产党员网、新华社等官方来源的正文作为证据；搜索摘要不作为结论。机器核查不能替代人工审签，P0 未核实或有冲突的表述不得直接发布。",
    "",
    "## 逐条结果",
    "",
  ];
  if (!checked.length) lines.push("未发现需要联网核查的政治性表述。");
  for (const claim of checked) {
    lines.push(`### ${claim.id} [${claim.risk}] ${claim.kindLabel}：${statusIcon(claim.verdict)}`);
    lines.push("");
    lines.push(`- 原文：${claim.sentenceText}`);
    if (claim.assertedDate?.text) lines.push(`- 文中年份/会期：${claim.assertedDate.text}`);
    lines.push(`- 判断：${claim.finding}`);
    if (claim.official?.length) {
      lines.push("- 官方依据：");
      for (const item of claim.official) {
        lines.push(`  - [${item.title || item.url}](${item.url})（${item.source}${item.date ? `，${item.date}` : ""}）`);
        if (item.quote) lines.push(`    > ${item.quote}`);
      }
    } else {
      lines.push("- 官方依据：暂未抓到可核对正文。");
    }
    if (claim.correction?.text) {
      lines.push(`- 建议改为：${claim.correction.text}`);
      lines.push(`- 自动校正：${claim.correction.safe ? "可精确替换" : "需人工确认"}`);
    } else if (claim.verdict !== "verified") {
      lines.push("- 建议：请人工到官网核对后再定稿，不要凭印象改写。");
    }
    lines.push("");
  }
  lines.push("## 处理建议");
  lines.push("");
  if (summary.conflict || summary.unverified || summary.needsReview) {
    lines.push("1. 先处理 P0 冲突和未核实项，再处理 P1 提法。");
    lines.push("2. 所有修改保留官方链接和原句，便于复核。");
    lines.push("3. 修改后重新核查一次，再导出 Word。");
  } else {
    lines.push("本次未发现冲突或未核实项，仍建议对关键表述做一次人工通读。");
  }
  return { markdown: lines.join("\n"), summary };
}

export { sourceLabel, authorityOf, P0, P1, P2 };
