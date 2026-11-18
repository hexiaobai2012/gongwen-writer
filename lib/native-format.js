// 公文写作助手 — 自包含 GB/T 9704 渲染/检查桥（python-docx）
import { spawn } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeFilePart, truncate } from "./util.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, "..", "python", "render_docx.py");
const EXTRACT_SCRIPT = resolve(__dirname, "..", "python", "extract_docx.py");

function logDir() {
  const dir = process.env.GONGWEN_WRITER_LOG_DIR || join(tmpdir(), "gongwen-writer");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function runProcess({ command, args, cwd, env, signal, timeoutMs = 60000 }) {
  return new Promise((resolvePromise) => {
    let settled = false;
    let timer = null;
    let outFd = null;
    let errFd = null;
    let outPath = "";
    let errPath = "";
    let child = null;
    const readAndClean = () => {
      let stdout = "";
      let stderr = "";
      try {
        if (outPath && existsSync(outPath)) stdout = readFileSync(outPath, "utf8");
      } catch {}
      try {
        if (errPath && existsSync(errPath)) stderr = readFileSync(errPath, "utf8");
      } catch {}
      for (const path of [outPath, errPath]) {
        try {
          if (path && existsSync(path)) unlinkSync(path);
        } catch {}
      }
      return { stdout, stderr };
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (child) child.removeAllListeners();
      for (const fd of [outFd, errFd]) {
        try {
          if (fd !== null) closeSync(fd);
        } catch {}
      }
      resolvePromise({ ...value, ...readAndClean() });
    };
    const onAbort = () => {
      try {
        child?.kill();
      } catch {}
      finish({ code: -2, stdout: "", stderr: "已取消。" });
    };
    try {
      const dir = logDir();
      const tag = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      outPath = join(dir, `nd-${tag}.out`);
      errPath = join(dir, `nd-${tag}.err`);
      outFd = openSync(outPath, "w");
      errFd = openSync(errPath, "w");
      child = spawn(command, args, {
        cwd,
        env,
        windowsHide: true,
        stdio: ["ignore", outFd, errFd],
      });
    } catch (error) {
      finish({ code: -1, stdout: "", stderr: error.message });
      return;
    }
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      finish({ code: -3, stdout: "", stderr: `执行超时（${timeoutMs}ms）。` });
    }, timeoutMs);
    child.on("error", (error) => finish({ code: -1, stdout: "", stderr: error.message }));
    child.on("close", (code) => finish({ code: code ?? -1, stdout: "", stderr: "" }));
  });
}

function pythonCandidates() {
  const out = [];
  if (process.env.GONGWEN_WRITER_PYTHON) out.push(process.env.GONGWEN_WRITER_PYTHON);
  const runtimes = join(homedir(), ".dsh", "dsh-runtimes");
  if (existsSync(runtimes)) {
    for (const name of readdirSync(runtimes)) {
      out.push(
        process.platform === "win32"
          ? join(runtimes, name, "dependencies", "python", "python.exe")
          : join(runtimes, name, "dependencies", "python", "bin", "python3"),
      );
    }
  }
  if (process.platform === "win32") {
    out.push("python", "python3", join(homedir(), "anaconda3", "python.exe"));
  } else {
    out.push("python3", "python");
  }
  return [...new Set(out)].filter(Boolean);
}

function envFor() {
  return {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONDONTWRITEBYTECODE: "1",
  };
}

let cachedPython = null;

export async function resolvePython({ force = false } = {}) {
  if (cachedPython?.ok && !force) return cachedPython;
  for (const command of pythonCandidates()) {
    if (command.includes("/") || command.includes("\\")) {
      if (!existsSync(command)) continue;
    }
    const res = await runProcess({
      command,
      args: [SCRIPT, "probe"],
      cwd: dirname(SCRIPT),
      env: envFor(),
      timeoutMs: 20000,
    });
    if (res.code === 0) {
      try {
        const data = JSON.parse(res.stdout.trim());
        cachedPython = { ok: true, command, ...data };
        return cachedPython;
      } catch {}
    }
  }
  cachedPython = {
    ok: false,
    error:
      "找不到可用的 Python（需要 python-docx）。DSH 自带 Python 通常已包含；也可设置环境变量 GONGWEN_WRITER_PYTHON 指向 python.exe。",
  };
  return cachedPython;
}

function parseJson(text) {
  const s = String(text || "").trim();
  try {
    return JSON.parse(s);
  } catch {
    const i = s.indexOf("{");
    const j = s.lastIndexOf("}");
    if (i >= 0 && j > i) {
      try {
        return JSON.parse(s.slice(i, j + 1));
      } catch {}
    }
    return null;
  }
}

function relativePath(workspace, absolute) {
  try {
    return relative(workspace, absolute).replace(/\\/g, "/");
  } catch {
    return absolute.replace(/\\/g, "/");
  }
}

export async function checkNative(docxPath, { signal, docType = "" } = {}) {
  const py = await resolvePython();
  if (!py.ok) return { ok: false, error: py.error, issues: [] };
  const res = await runProcess({
    command: py.command,
    args: [SCRIPT, "check", docxPath, docType],
    cwd: dirname(SCRIPT),
    env: envFor(),
    signal,
    timeoutMs: 60000,
  });
  if (res.code !== 0) return { ok: false, error: truncate(res.stderr || res.stdout, 2000), issues: [] };
  const data = parseJson(res.stdout);
  return data || { ok: false, error: truncate(res.stdout, 2000), issues: [] };
}

export async function renderNative(project, store, { workspace, aiDeclaration = false, signal, check = true } = {}) {
  const py = await resolvePython();
  if (!py.ok) return { ok: false, error: py.error };

  store.ensureProjectDirs(project);
  const title = String(project.title || "公文").trim() || "公文";
  const base = sanitizeFilePart(title, 60) || "公文";
  const canonical = join(workspace, `${base}_打磨版.docx`);
  const previewDir = join(store.baseDir, "preview");
  const stable = join(previewDir, "当前打磨稿.docx");
  for (const dir of [previewDir, store.tmpDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const recipientFromParagraphs = project.paragraphs?.find((p) => p.role === "recipient")?.text || "";
  const signatureFromParagraphs = project.paragraphs?.find((p) => p.role === "signature")?.text || "";
  const dateFromParagraphs = project.paragraphs?.find((p) => p.role === "date")?.text || "";

  const payload = {
    title,
    docType: project.docType || "notice",
    issuer: project.issuer || signatureFromParagraphs,
    recipient: project.recipient || recipientFromParagraphs,
    date: project.date || dateFromParagraphs,
    paragraphs: (project.paragraphs || [])
      .filter((p) => !["title", "recipient", "signature", "date"].includes(p.role))
      .map((p) => ({ role: p.role || "body", text: p.text })),
    output: canonical,
    options: { aiDeclaration: Boolean(aiDeclaration) },
  };

  const revision = Number(project.previewRevision || 0) + 1;
  const inputPath = join(store.tmpDir, `render-${project.id}-${revision}.json`);
  writeFileSync(inputPath, JSON.stringify(payload, null, 2), "utf8");

  const res = await runProcess({
    command: py.command,
    args: [SCRIPT, "render", inputPath],
    cwd: dirname(SCRIPT),
    env: envFor(),
    signal,
    timeoutMs: 120000,
  });
  try {
    if (existsSync(inputPath)) unlinkSync(inputPath);
  } catch {}

  if (res.code !== 0 || !existsSync(canonical)) {
    return {
      ok: false,
      error: "生成 Word 失败。",
      stdout: truncate(res.stdout, 2000),
      stderr: truncate(res.stderr, 2000),
    };
  }

  // 稳定预览文件：侧边栏打开一次后，后续写入同一路径即可自动刷新。
  copyFileSync(canonical, stable);

  // 标题变化后清理旧的《旧标题_打磨版.docx》，避免工作区堆积。
  const oldDocx = project.preview?.docxAbsolute;
  if (oldDocx && oldDocx !== canonical && oldDocx.endsWith("_打磨版.docx") && existsSync(oldDocx)) {
    try {
      unlinkSync(oldDocx);
    } catch {}
  }

  const checkResult = check ? await checkNative(canonical, { signal, docType: project.docType }) : null;
  const preview = {
    ok: true,
    docx: relativePath(workspace, canonical),
    docxAbsolute: canonical,
    stable: relativePath(workspace, stable),
    stableAbsolute: stable,
    title,
    revision,
    updatedAt: new Date().toISOString(),
    check: checkResult,
  };
  writeFileSync(
    join(store.baseDir, "preview.json"),
    JSON.stringify(preview, null, 2),
    "utf8",
  );

  project.preview = preview;
  project.previewRevision = revision;
  return preview;
}

export async function doctorNative() {
  const py = await resolvePython({ force: true });
  const out = {
    ok: Boolean(py.ok),
    python: py.command,
    pythonVersion: py.python,
    pythonDocx: py["python-docx"],
    script: SCRIPT,
    standard:
      "GB/T 9704-2012（A4；上37/下35/左28/右26mm；正文三号仿宋；固定行距28pt；无段前段后；页码四号仿宋、奇右偶左；落款首行右空4字、日期居中）",
  };
  if (!py.ok) out.error = py.error || "Python/python-docx 不可用。";
  return out;
}

export async function extractDocx(path, { signal } = {}) {
  const py = await resolvePython();
  if (!py.ok) return { ok: false, error: py.error, paragraphs: [] };
  const res = await runProcess({
    command: py.command,
    args: [EXTRACT_SCRIPT, path],
    cwd: dirname(EXTRACT_SCRIPT),
    env: envFor(),
    signal,
    timeoutMs: 60000,
  });
  if (res.code !== 0) return { ok: false, error: truncate(res.stderr || res.stdout, 2000), paragraphs: [] };
  const data = parseJson(res.stdout);
  return data || { ok: false, error: truncate(res.stdout, 2000), paragraphs: [] };
}

export async function exportProjectNative(project, store, { workspace, aiDeclaration = false, signal } = {}) {
  const preview = await renderNative(project, store, { workspace, aiDeclaration, signal, check: true });
  if (!preview.ok) {
    const failure = {
      success: false,
      error: preview.error || "生成 Word 失败。",
    };
    if (preview.stdout) failure.stdout = preview.stdout;
    if (preview.stderr) failure.stderr = preview.stderr;
    return failure;
  }
  const issues = preview.check?.issues || [];
  const counts = { P0: 0, P1: 0, P2: 0 };
  for (const issue of issues) {
    if (counts[issue.severity] !== undefined) counts[issue.severity] += 1;
  }
  return {
    success: true,
    docx: preview.docxAbsolute,
    relative: preview.docx,
    stable: preview.stableAbsolute,
    preview,
    check: {
      ok: Boolean(preview.check?.ok),
      p0: counts.P0,
      p1: counts.P1,
      p2: counts.P2,
      total: issues.length,
      issues,
    },
    warnings: [
      ...(counts.P0 ? [`存在 ${counts.P0} 个 P0 格式问题，必须修复后再交付。`] : []),
    ],
  };
}

export function previewAddress(sessionId, workspace, preview) {
  if (!preview?.stable) return null;
  const rel = preview.stable.replace(/\\/g, "/");
  return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${rel
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export { relativePath, parseJson };
