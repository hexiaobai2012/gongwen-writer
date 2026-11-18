// 公文写作助手 — 官方微信公众号检索与读取
//
// 说明：
// - 检索只负责发现 mp.weixin.qq.com 文章线索；
// - 必须再用 read 打开文章，核验公众号名称是否在官方白名单；
// - 微信文章直接 fetch 常被验证页拦截，读取统一走本地 Chrome（需用户确认）。

import { openAndRead } from "./browser.js";
import { countChars, decodeEntities, truncate } from "./util.js";

export const WECHAT_HOST = "mp.weixin.qq.com";

export const DEFAULT_WECHAT_ACCOUNTS = [
  "中国政府网",
  "人民日报",
  "人民日报评论",
  "新华社",
  "新华网",
  "央视新闻",
  "央视网",
  "共产党员",
  "求是网",
  "共青团中央",
  "公安部",
  "应急管理部",
  "自然资源部",
  "生态环境部",
  "教育部",
  "国家卫生健康委",
  "财政部",
  "国家税务总局",
  "国务院国资委",
  "最高人民法院",
  "最高人民检察院",
  "北京发布",
  "上海发布",
  "天津发布",
  "重庆发布",
  "广东发布",
  "浙江发布",
  "江苏发布",
  "山东发布",
  "河南发布",
  "四川发布",
  "湖北发布",
  "湖南发布",
  "安徽发布",
  "福建发布",
  "江西发布",
  "陕西发布",
  "甘肃发布",
  "云南发布",
  "贵州发布",
  "广西发布",
  "海南发布",
  "辽宁发布",
  "吉林发布",
  "黑龙江发布",
  "内蒙古发布",
  "新疆发布",
  "西藏发布",
  "宁夏发布",
  "青海发布",
  "山西发布",
  "河北发布",
];

const ACCOUNT_SET = new Set(DEFAULT_WECHAT_ACCOUNTS.map(normalizeAccount));

function normalizeAccount(name) {
  return String(name || "")
    .replace(/[\s\u3000]+/g, "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/公众号$/, "")
    .trim();
}

export function isWechatArticleUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() !== WECHAT_HOST) return false;
    return u.pathname === "/s" || u.pathname.startsWith("/s/") || u.pathname.startsWith("/mp/");
  } catch {
    return false;
  }
}

/** 是否在官方公众号白名单；accounts 可用于补充本单位/本地官方账号。 */
export function isOfficialWechatAccount(name, accounts = []) {
  const normalized = normalizeAccount(decodeEntities(name));
  if (!normalized) return false;
  if (ACCOUNT_SET.has(normalized)) return true;
  return accounts.map(normalizeAccount).filter(Boolean).includes(normalized);
}

function accountList(accounts) {
  const extra = Array.isArray(accounts) ? accounts : [];
  return [...new Set([...DEFAULT_WECHAT_ACCOUNTS, ...extra].map(normalizeAccount).filter(Boolean))];
}

function queryQuote(text) {
  return `"${String(text || "").replace(/["“”]/g, "").trim()}"`;
}

/**
 * 用已配置的 web 搜索发现微信公众号文章。
 * 搜索结果只作为线索，accountHint 未经正文核验。
 */
export async function searchWechat({ query, web, accounts, maxResults = 6, signal } = {}) {
  if (!web?.search) throw new Error("当前环境没有可用的联网搜索服务，无法检索微信公众号。");
  const q = String(query || "").trim();
  if (!q) throw new Error("检索微信公众号需要 query。");
  const list = accountList(accounts);
  const picked = list.slice(0, 5);
  const queries = picked.map((account) => `site:${WECHAT_HOST} ${queryQuote(account)} ${q}`);
  const errors = [];
  const found = [];

  for (const item of queries) {
    try {
      const result = await web.search({ query: item, maxResults: 8 }, signal);
      for (const source of result?.sources || []) {
        if (!isWechatArticleUrl(source.url)) continue;
        found.push({
          title: source.title || "",
          url: source.url,
          queryAccount: item.match(/"(.*?)"/)?.[1] || "",
          accountVerified: false,
          searchQuery: item,
          publishedAt: source.publishedAt || "",
        });
      }
    } catch (error) {
      errors.push({ query: item, error: String(error?.message || error) });
    }
  }

  // 账号定向没有结果时，再做一次不限定账号的站内检索；仍需 read 核验账号。
  if (!found.length) {
    const fallback = `site:${WECHAT_HOST} ${q}`;
    try {
      const result = await web.search({ query: fallback, maxResults: 8 }, signal);
      for (const source of result?.sources || []) {
        if (!isWechatArticleUrl(source.url)) continue;
        found.push({
          title: source.title || "",
          url: source.url,
          queryAccount: "",
          accountVerified: false,
          searchQuery: fallback,
          publishedAt: source.publishedAt || "",
        });
      }
    } catch (error) {
      errors.push({ query: fallback, error: String(error?.message || error) });
    }
  }

  const seen = new Set();
  const results = [];
  for (const item of found) {
    const url = String(item.url || "").split("#")[0];
    if (!url || seen.has(url)) continue;
    seen.add(url);
    results.push({ ...item, url, source: "wechat", sourceLabel: "微信公众号（待核验账号）" });
  }
  results.sort((a, b) => {
    const at = String(a.title || "");
    const bt = String(b.title || "");
    return Number(bt.includes(q)) - Number(at.includes(q));
  });
  return {
    results: results.slice(0, Math.max(1, Math.min(12, Number(maxResults) || 6))),
    errors,
    accounts: picked,
    note: results.length
      ? "微信结果只是线索；请用 gongwen_research action=read 打开文章，核验公众号名称是否在白名单。"
      : "未检索到微信公众号文章。可换关键词，或用 wechatAccounts 指定本地官方账号名。",
  };
}

function formatPublishTime(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^\d{9,12}$/.test(s)) {
    const ms = Number(s) * (s.length <= 10 ? 1000 : 1);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return s;
}

/** 打开并读取一篇微信公众号文章；调用方应先在 gongwen_research 里走审批。 */
function isCaptcha(page) {
  const preview = `${page?.title || ""} ${String(page?.text || "").slice(0, 300)}`;
  return /环境异常|完成验证|wappoc_appmsgcaptcha|captcha/i.test(preview);
}

export async function readWechat(url, { workspace, waitMs = 3000, signal, accounts } = {}) {
  if (!isWechatArticleUrl(url)) throw new Error("不是微信公众号文章链接。");
  let page = await openAndRead(url, { workspace, headless: false, waitMs, signal });
  // 微信偶发验证页：换 https/等待后再试一次；仍失败则明确报错。
  if (!page.ok || isCaptcha(page) || !page.accountName) {
    const httpsUrl = String(url).replace(/^http:/i, "https:");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const retry = await openAndRead(httpsUrl, { workspace, headless: false, waitMs: waitMs + 1500, signal });
    if (retry.ok) page = retry;
  }
  if (!page.ok) throw new Error(page.error || "打开微信公众号文章失败。");
  const accountName = decodeEntities(page.accountName || "").replace(/\s+/g, " ").trim();
  if (isCaptcha(page)) {
    throw new Error("微信返回了环境异常/验证页，暂时读不到正文。请稍后重试，或在手机微信中打开链接。");
  }
  if (!accountName) {
    throw new Error("未能识别公众号名称，无法确认是否为官方账号。");
  }
  const officialAccount = isOfficialWechatAccount(accountName, accounts);
  return {
    ok: true,
    title: page.title || "",
    url: page.url || url,
    text: String(page.text || "").slice(0, 20000),
    chars: page.chars || countChars(page.text || ""),
    accountName,
    userName: page.userName || "",
    biz: page.biz || "",
    publishTime: formatPublishTime(page.publishTime || ""),
    officialAccount,
    source: "wechat",
    sourceLabel: `微信公众号·${accountName}`,
    excerpt: truncate(String(page.text || "").replace(/\s+/g, " ").trim(), 500),
  };
}
