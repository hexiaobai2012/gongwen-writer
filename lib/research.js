// 公文写作助手 — 官方范文检索（人民网观点 / 共产党员网先锋文汇 / 中国政府网政策）
import { countChars, decodeEntities, stripHtml, truncate } from "./util.js";

export const SOURCES = {
  people: {
    label: "人民网·观点",
    short: "人民网",
    pages: [
      "http://opinion.people.com.cn/",
      "http://opinion.people.com.cn/GB/8213/49160/index.html",
      "http://opinion.people.com.cn/GB/8213/49160/461970/index.html",
    ],
    hosts: ["people.com.cn"],
  },
  "12371": {
    label: "共产党员网·先锋文汇",
    short: "共产党员网",
    pages: ["https://tougao.12371.cn/wenhui.php", "https://tougao.12371.cn/tuijian.php"],
    hosts: ["12371.cn"],
  },
  gov: {
    label: "中国政府网·政策",
    short: "中国政府网",
    pages: [
      "https://www.gov.cn/zhengce/",
      "https://www.gov.cn/zhengce/zuixin/",
      "https://www.gov.cn/zhengce/jiedu/",
    ],
    hosts: ["gov.cn"],
  },
  dangjian: {
    label: "党建网",
    short: "党建网",
    pages: ["http://www.dangjian.cn/"],
    hosts: ["dangjian.cn"],
  },
  chinanews: {
    label: "中国新闻网",
    short: "中新网",
    pages: ["https://www.chinanews.com.cn/", "https://www.chinanews.com.cn/scroll-news/news1.html"],
    hosts: ["chinanews.com.cn"],
  },
  qizhiwang: {
    label: "旗帜网",
    short: "旗帜网",
    pages: ["http://www.qizhiwang.org.cn/", "http://www.qizhiwang.org.cn/GB/457278/index.html"],
    hosts: ["qizhiwang.org.cn"],
  },
  rmlt: {
    label: "人民论坛网",
    short: "人民论坛",
    pages: [
      "https://www.rmlt.com.cn/",
      "https://politics.rmlt.com.cn/",
      "https://www.rmlt.com.cn/xuexi/",
      "https://www.rmlt.com.cn/idea/",
      "https://www.rmlt.com.cn/dangjian/",
      "https://www.rmlt.com.cn/original/",
      "https://governance.rmlt.com.cn/",
    ],
    hosts: ["rmlt.com.cn"],
  },
  wechat: {
    label: "官方微信公众号",
    short: "微信公众号",
    pages: [],
    hosts: ["mp.weixin.qq.com"],
  },
};

const OFFICIAL_SUFFIXES = [
  "gov.cn",
  "npc.gov.cn",
  "cppcc.gov.cn",
  "ccdi.gov.cn",
  "court.gov.cn",
  "spp.gov.cn",
  "mfa.gov.cn",
  "mod.gov.cn",
  "81.cn",
  "people.com.cn",
  "12371.cn",
  "xinhuanet.com",
  "news.cn",
  "qstheory.cn",
  "cctv.com",
  "china.com.cn",
  "chinadaily.com.cn",
  "ce.cn",
  "gmw.cn",
  "youth.cn",
  "dangjian.cn",
  "chinanews.com.cn",
  "chinanews.com",
  "qizhiwang.org.cn",
  "rmlt.com.cn",
];

const NAV_WORDS = [
  "首页", "更多", "点击", "登录", "注册", "English", "返回", "网站地图", "联系我们", "关于我们",
  "无障碍", "简体", "繁体", "RSS", "版权", "广告", "招聘", "订阅", "微博", "微信", "客户端",
  "主办", "承办", "京ICP", "公网安备", "违法和不良信息", "举报", "切换", "收藏", "分享",
];

const NAV_TITLES = new Set([
  "每周经济评论",
  "人民日报要论",
  "人民锐评",
  "先锋文汇学习心得",
  "专题图集",
  "人民日报重要言论库",
  "24小时点击排行",
  "点击查看更多",
  "更多>>",
]);

const ARTICLE_HINTS = ["通知", "意见", "报告", "请示", "批复", "决定", "讲话", "评论", "政策", "解读", "理论", "时评", "锐评", "文汇", "治理", "发展", "工作"];

const GENERIC_WORDS = new Set([
  "通知", "意见", "报告", "请示", "批复", "决定", "公告", "通告", "函", "纪要", "方案", "讲话", "材料", "公文",
]);

// 栏目/列表页不是文章，不能作为范文精读。
function isArticleUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const path = u.pathname.toLowerCase();
  const search = u.search.toLowerCase();
  if (/\/(index|default|list|search|tuijian|wenhui)(\.(html?|php|shtml))?$/.test(path)) return false;
  if (path.includes("/special/")) return false;
  if (path.includes("/shipin/") || path.includes("/spxw/") || path.includes("/tp/")) return false;
  if (/\/$/.test(path) && !/content_|tid=/.test(path + search)) return false;
  if (path.endsWith(".php") && !search.includes("tid=")) return false;
  return /content_\d+|tid=\d+|\/n1\/\d{4}\/\d{4}\/|\/20\d{2}[-/]\d{1,2}[-/]\d{1,2}\/|\/20\d{2}\/\d{4}\//.test(path + search);
}

function decodeBuffer(buf, contentType) {
  const head = Buffer.from(buf).subarray(0, 2048).toString("latin1");
  const m =
    /charset\s*=\s*["']?([\w-]+)/i.exec(contentType || "") ||
    /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
  let enc = (m?.[1] || "utf-8").toLowerCase();
  if (enc === "gb2312" || enc === "gbk") enc = "gb18030";
  try {
    return new TextDecoder(enc).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

function combineSignals(signal, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason || new Error("aborted"));
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

export async function fetchPage(url, { signal, timeoutMs = 20000 } = {}) {
  const combined = combineSignals(signal, timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: combined.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "zh-CN,zh;q=0.9",
      },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return {
      url: res.url || url,
      status: res.status,
      html: decodeBuffer(buf, res.headers.get("content-type")),
    };
  } finally {
    combined.dispose();
  }
}

export function isOfficialUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    return OFFICIAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

// 旗帜网当前 HTTPS 证书域名不匹配，官网实际以 HTTP 提供服务；统一降级到 HTTP。
export function normalizeOfficialUrl(url) {
  const u = new URL(url);
  if (u.hostname.toLowerCase().endsWith("qizhiwang.org.cn") && u.protocol === "https:") {
    u.protocol = "http:";
  }
  return u.href;
}

function cleanTitle(raw) {
  return decodeEntities(stripHtml(raw))
    .replace(
      /\s*[-_—|]{1,2}\s*(?:观点|评论|理论|时评|人民网|中国共产党新闻网|共产党员网|中国政府网|新华网|央视网|求是网|中新网|中国新闻网|党建网|旗帜网|人民论坛网|人民论坛)[\s\S]*$/i,
      "",
    )
    .replace(/\s*\(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?\)\s*$/, "")
    .replace(/\s+20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDate(text) {
  const s = String(text || "");
  const patterns = [
    /发表时间[：:]\s*(20\d{2})[-年/.](\d{1,2})[-月/.](\d{1,2})/,
    /发布时间[：:]\s*(20\d{2})[-年/.](\d{1,2})[-月/.](\d{1,2})/,
    /(?:publishdate|pubdate|publish_time|pubtime)["']?\s*(?:content=)?["'](20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/i,
    /(20\d{2})[-年/.](\d{1,2})[-月/.](\d{1,2})/,
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  }
  return "";
}

export function extractLinks(html, baseUrl, { hosts = [] } = {}) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1].trim();
    if (!href || /^(javascript|mailto|tel|#)/i.test(href)) continue;
    let absolute;
    try {
      absolute = new URL(href, baseUrl).href;
    } catch {
      continue;
    }
    if (!/^https?:/i.test(absolute)) continue;
    if (hosts.length) {
      const host = new URL(absolute).hostname.toLowerCase();
      if (!hosts.some((h) => host === h || host.endsWith(`.${h}`))) continue;
    }
    const title = cleanTitle(m[2]);
    if (!title || title.length < 6 || title.length > 90) continue;
    if (NAV_WORDS.some((w) => title.includes(w))) continue;
    if (NAV_TITLES.has(title)) continue;
    if (/征稿启事|征求意见表|招聘|招录|启事|投稿须知|订阅|声明|公示|名单|图片选登|每日推荐/.test(title)) continue;
    if (!isArticleUrl(absolute)) continue;
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    out.push({ title, url: absolute, date: extractDate(title) || "" });
  }
  return out;
}

function tokenize(query) {
  const q = String(query || "").trim();
  const parts = q.split(/[\s,，、;；/]+/).map((s) => s.trim()).filter((s) => s.length >= 2);
  return [...new Set([q, ...parts].filter(Boolean))];
}

function scoreTitle(title, tokens, query = "") {
  let score = 0;
  for (const token of tokens) {
    if (title.includes(token)) score += token.length >= 4 ? 4 : 3;
  }
  if (query && title.includes(query)) score += 5;
  // 只有命中关键词后才给“像文章”加分，避免“意见/通知”等词把无关文章抬进结果。
  if (score > 0 && ARTICLE_HINTS.some((h) => title.includes(h))) score += 1;
  return score;
}

export async function searchOfficial({ query, sources = ["people", "12371", "gov"], maxResults = 6, signal } = {}) {
  const tokens = tokenize(query);
  const meaningful = tokens.filter((t) => t !== query && !GENERIC_WORDS.has(t));
  const scoringTokens = meaningful.length ? meaningful : tokens;
  const selected = sources.filter((s) => SOURCES[s]);
  if (!selected.length) throw new Error(`sources 只能是：${Object.keys(SOURCES).join("、")}`);
  const perSource = Math.max(3, Math.ceil(maxResults / selected.length) + 2);
  const results = [];
  const errors = [];

  for (const key of selected) {
    const source = SOURCES[key];
    const candidates = [];
    for (const page of source.pages) {
      try {
        const { html, url } = await fetchPage(page, { signal });
        for (const link of extractLinks(html, url, { hosts: source.hosts })) {
          candidates.push({ ...link, source: key, sourceLabel: source.label, score: scoreTitle(link.title, scoringTokens, query) });
        }
      } catch (error) {
        errors.push({ source: key, page, error: error.message });
      }
    }
    const deduped = [];
    const seen = new Set();
    for (const item of candidates) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      deduped.push(item);
    }
    deduped.sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date)));
    const matched = deduped.filter((x) => x.score > 0).slice(0, perSource);
    const fallback = deduped.slice(0, Math.min(3, perSource)).map((x) => ({ ...x, score: 0, matched: false }));
    const picked = matched.length ? matched.map((x) => ({ ...x, matched: true })) : fallback;
    results.push(...picked);
  }

  const ordered = [];
  const bySource = new Map();
  for (const item of results) {
    if (!bySource.has(item.source)) bySource.set(item.source, []);
    bySource.get(item.source).push(item);
  }
  let added = true;
  while (added && ordered.length < maxResults) {
    added = false;
    for (const key of selected) {
      const list = bySource.get(key) || [];
      const next = list.shift();
      if (next) {
        ordered.push(next);
        added = true;
        if (ordered.length >= maxResults) break;
      }
    }
  }

  return {
    query,
    tokens,
    results: ordered.map(({ score, ...rest }) => rest),
    errors,
    note:
      ordered.length === 0
        ? "各站点栏目列表暂未取到可读条目。可改用 web_search 检索官网（加 site:gov.cn / site:people.com.cn / site:12371.cn / site:dangjian.cn / site:chinanews.com.cn / site:qizhiwang.org.cn / site:rmlt.com.cn 限定），再用 gongwen_research action=read 精读。"
        : ordered.some((x) => x.matched === false)
          ? "部分来源未命中关键词，返回的是该栏目近期文章，仅作结构/提法参考。"
          : "结果均来自官网栏目页，可继续用 action=read 精读。",
  };
}

export function extractArticle(html, pageUrl) {
  const cleaned = String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ");
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(cleaned);
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(cleaned);
  const h1Title = cleanTitle(h1?.[1] || "");
  const tagTitle = cleanTitle(titleTag?.[1] || "");
  const title = h1Title.length >= 6 && !/logo|人民网|共产党员网|中国政府网/i.test(h1Title) ? h1Title : tagTitle || h1Title;

  // 优先截取正文容器，避免把导航、推荐位、版权区当成正文。
  let content = cleaned;
  const bodyMarker = /<!--\s*正文start\s*-->([\s\S]*?)<!--\s*正文end\s*-->/i.exec(cleaned);
  if (bodyMarker) {
    content = bodyMarker[1];
  } else {
    const articleContent = cleaned.search(/<div[^>]+class=["'][^"']*article-content[^"']*["'][^>]*>/i);
    const trs = cleaned.search(/<div[^>]+class=["'][^"']*TRS_Editor[^"']*["'][^>]*>/i);
    const tex = cleaned.search(/<div[^>]+id=["']tex["'][^>]*>/i);
    const start = articleContent >= 0 ? articleContent : trs >= 0 ? trs : tex;
    if (start >= 0) content = cleaned.slice(start);
  }

  // 人民论坛网正文后紧跟编辑信息、相关推荐和侧栏，按首个标记截断。
  try {
    if (new URL(pageUrl).hostname.endsWith("rmlt.com.cn")) {
      const cut = /<div[^>]+class=["'][^"']*(?:editor|new-list|column-aside)[^"']*["'][^>]*>/i.exec(content);
      if (cut && cut.index > 200) content = content.slice(0, cut.index);
    }
  } catch {
    // ignore
  }

  const blockText = decodeEntities(
    content
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|td|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

  const BOILER = /^(中共中央宣传部|《党建》杂志社|在线投稿|公示|启事|党建网\s*>|来源[：:]|作者[：:]|发表时间[：:]|投稿邮箱[：:]|分享|打印|纠错|请先登录|投稿须知|微信扫一扫|扫一扫|责任编辑|编辑[：:]|【编辑|原标题|相关阅读|上一篇|下一篇|中国新闻网|中新网|Copyright|版权所有|网站地图|关于我们|联系我们|违法和不良信息|京ICP|互联网新闻信息服务许可证|更多精彩|相关新闻|推荐阅读|要闻|理论|评论|专题|视频|图片|English|中央机构编制委员会办公室|中央党校|中国国家铁路集团有限公司)/;
  const lines = [];
  const seen = new Set();
  for (const rawLine of blockText.split("\n")) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (line.length < 12) continue;
    if (BOILER.test(line)) continue;
    if (/(责任编辑|扫一扫|分享到|客户端|广告|版权|互联网新闻信息服务|京ICP|Copyright|投稿邮箱|送签[：:]|签发[：:]|编辑[：:])/.test(line)) continue;
    if (title && line.startsWith(title)) continue;
    if (line.includes("旗帜网") && line.length < 50) continue;
    if (line.includes(">") && line.length < 40) continue;
    if (seen.has(line)) continue;
    if (lines.some((prev) => prev.length > 40 && line.includes(prev.slice(0, 60)))) continue;
    seen.add(line);
    lines.push(line);
  }

  let text = lines.join("\n");
  if (countChars(text) < 200) {
    const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(cleaned)?.[1] || cleaned;
    text = stripHtml(body)
      .replace(/[ \t\u3000]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim();
  }
  const date = extractDate(cleaned.slice(0, 30000));
  return {
    title: title || "未命名材料",
    text: text.slice(0, 20000),
    date,
    chars: countChars(text),
    url: pageUrl,
  };
}

export async function readOfficial(url, { signal } = {}) {
  const normalized = normalizeOfficialUrl(url);
  if (!isOfficialUrl(normalized)) {
    throw new Error("只读取官方网站（.gov.cn、people.com.cn、12371.cn、dangjian.cn、chinanews.com.cn、qizhiwang.org.cn、rmlt.com.cn 等）。");
  }
  const { html, url: finalUrl } = await fetchPage(normalized, { signal });
  const article = extractArticle(html, finalUrl);
  const sourceKey =
    Object.keys(SOURCES).find((key) => SOURCES[key].hosts.some((h) => new URL(finalUrl).hostname.endsWith(h))) || "other";
  return {
    ...article,
    source: sourceKey,
    sourceLabel: SOURCES[sourceKey]?.label || "官方网站",
    excerpt: truncate(article.text.replace(/\n/g, " "), 500),
  };
}
