// 公文写作助手 — 受控本地 Chrome（CDP）读取参考资料
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_CANDIDATES = [
  process.env.GONGWEN_CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Google", "Chrome", "Application", "chrome.exe"),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

let lastChild = null;

export function findChrome() {
  for (const path of CHROME_CANDIDATES) {
    try {
      if (existsSync(path)) return path;
    } catch {}
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, { timeoutMs = 20000, intervalMs = 250, signal } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("已取消。");
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw lastError || new Error("等待超时。");
}

async function cdpCall(ws, idRef, method, params = {}, timeoutMs = 15000) {
  const id = ++idRef.value;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      reject(new Error(`CDP ${method} 超时`));
    }, timeoutMs);
    const onMessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function waitForLoad(ws, idRef, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      resolve({ timedOut: true });
    }, timeoutMs);
    const onMessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.method === "Page.loadEventFired") {
        clearTimeout(timer);
        ws.removeEventListener("message", onMessage);
        resolve({ timedOut: false });
      }
    };
    ws.addEventListener("message", onMessage);
  });
}

function killChrome(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.unref();
    } else {
      child.kill("SIGKILL");
    }
  } catch {}
}

export async function openAndRead(url, { workspace, headless = false, waitMs = 3000, signal } = {}) {
  const chrome = findChrome();
  if (!chrome) {
    return { ok: false, error: "没有找到本地 Chrome。可设置 GONGWEN_CHROME_PATH 指向 chrome.exe。" };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "URL 无效。" };
  }
  if (!/^https?:$/.test(parsed.protocol)) return { ok: false, error: "只支持 http/https 链接。" };

  const port = await freePort();
  const profileDir = join(tmpdir(), "gongwen-writer-chrome", `${process.pid}-${Date.now()}`);
  if (!existsSync(profileDir)) mkdirSync(profileDir, { recursive: true });
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-extensions",
    "--disable-crash-reporter",
    "--disable-breakpad",
    "--disable-gpu",
    "--noerrdialogs",
    ...(process.platform === "win32" && process.env.GONGWEN_CHROME_NO_SANDBOX !== "0" ? ["--no-sandbox"] : []),
    ...(process.platform !== "win32" ? ["--disable-dev-shm-usage"] : []),
    ...(headless ? ["--headless=new"] : []),
    "about:blank",
  ];
  lastChild = spawn(chrome, args, { windowsHide: true, stdio: "ignore" });
  let ws = null;
  let tabId = null;
  try {
    const version = await waitFor(
      async () => {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal });
        if (!res.ok) return null;
        return res.json();
      },
      { timeoutMs: 20000, signal },
    );

    // 新版本 Chrome 要求 PUT；旧版本用 GET。
    let created = null;
    for (const method of ["PUT", "GET"]) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`, {
          method,
          signal,
        });
        if (res.ok) {
          created = await res.json();
          break;
        }
      } catch {}
    }
    if (!created) {
      const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal })).json();
      created = tabs.find((t) => t.type === "page");
    }
    if (!created?.webSocketDebuggerUrl) throw new Error("无法创建 Chrome 标签页。");
    tabId = created.id;

    ws = new WebSocket(created.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("连接 Chrome 调试端口超时。")), 15000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("连接 Chrome 调试端口失败。"));
      });
    });

    const idRef = { value: 0 };
    await cdpCall(ws, idRef, "Page.enable");
    const loaded = waitForLoad(ws, idRef, 25000);
    await cdpCall(ws, idRef, "Page.navigate", { url: parsed.href });
    await loaded;
    if (waitMs > 0) await sleep(waitMs);

    const result = await cdpCall(ws, idRef, "Runtime.evaluate", {
      expression: `(() => {
        const pick = document.querySelector('#js_content, .rich_media_content, article, .article-content, .content, main');
        const root = pick && (pick.innerText || '').trim().length > 80 ? pick : document.body;
        const scripts = Array.from(document.scripts).map((s) => s.textContent || '').join(' ');
        const grab = (re) => { const m = re.exec(scripts); return m ? m[1] : ''; };
        const meta = (key) => {
          const el = document.querySelector('meta[property="' + key + '"], meta[name="' + key + '"]');
          return el ? (el.content || '') : '';
        };
        return {
          title: document.title || '',
          url: location.href,
          text: (root && root.innerText ? root.innerText : document.body.innerText || '').trim(),
          ogTitle: meta('og:title'),
          description: meta('description') || meta('og:description'),
          accountName:
            grab(/nickname\\s*=\\s*["']([^"']*)["']/) ||
            ((document.querySelector('#js_name, .profile_nickname, .rich_media_meta_nickname') || {}).innerText || '').trim() ||
            meta('og:site_name'),
          userName: grab(/user_name\\s*=\\s*["']([^"']*)["']/) || (typeof window.user_name === 'string' ? window.user_name : ''),
          biz: grab(/biz\\s*=\\s*["']([^"']*)["']/) || (typeof window.biz === 'string' ? window.biz : ''),
          publishTime:
            grab(/publish_time\\s*=\\s*["']([^"']*)["']/) ||
            grab(/create_time\\s*=\\s*["']([^"']*)["']/) ||
            (typeof window.publish_time === 'string' ? window.publish_time : ''),
        };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    const value = result?.result?.value || {};
    return {
      ok: true,
      title: value.ogTitle || value.title || "",
      rawTitle: value.title || "",
      url: value.url || parsed.href,
      text: String(value.text || "").slice(0, 20000),
      chars: String(value.text || "").replace(/\s+/g, "").length,
      accountName: String(value.accountName || "").trim(),
      userName: String(value.userName || "").trim(),
      biz: String(value.biz || "").trim(),
      publishTime: String(value.publishTime || "").trim(),
      description: String(value.description || "").trim(),
      browser: version.Browser || "",
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  } finally {
    try {
      if (tabId) await fetch(`http://127.0.0.1:${port}/json/close/${tabId}`);
    } catch {}
    try {
      ws?.close();
    } catch {}
    killChrome(lastChild);
    lastChild = null;
    try {
      rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {}
  }
}

export function closeBrowser() {
  killChrome(lastChild);
  lastChild = null;
}
