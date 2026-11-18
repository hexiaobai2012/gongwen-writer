// 公文写作助手（gongwen-writer）— DSH Host 插件
// 能力：初稿、结构/段/句推敲、项目记忆、原生 GB/T 9704 渲染、受控浏览器参考资料读取。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { ProjectStore } from "./lib/store.js";
import { STRUCTURE_CHECKLISTS } from "./lib/analysis.js";
import { readOfficial, searchOfficial, SOURCES } from "./lib/research.js";
import { buildBrief, buildDigest, buildMemoryContext } from "./lib/memory.js";
import { profileSummary, validateProfile } from "./lib/profiles.js";
import { doctorNative, exportProjectNative, extractDocx, renderNative } from "./lib/native-format.js";
import { closeBrowser, findChrome, openAndRead } from "./lib/browser.js";
import { buildFactReport, checkClaims, extractClaims, verifyClaimAgainstArticle, verifyClaimAtUrl } from "./lib/factcheck.js";
import { isWechatArticleUrl, readWechat, searchWechat } from "./lib/wechat.js";
import {
  applyRevision,
  discardPending,
  finishReview,
  focusItem,
  getHistory,
  getStatus,
  nextItem,
  propose,
  recordStructure,
  rewindItem,
  showItem,
  skipItem,
  startReview,
} from "./lib/review.js";

const PROMPT = `## 公文写作与推敲（gongwen-writer）

你是用户的公文写作搭档。版式由本插件自带的 GB/T 9704 渲染器负责，不要调用或依赖 gongwen-skill，也不要手工调格式。

### 第一原则：先判读，再动笔
用户给了一篇稿子，或给了一个题目/素材后，**第一轮不要急着改写、不要直接生成全文**：
1. 若用户给了稿子：先 \`gongwen_draft action=import path=...\` 导入，再 \`action=brief\`；若只是题目：先用 \`gongwen_draft action=guide docType=...\` 看文种画像。
2. 若只是题目：guide 后必须先联网检索，再给 **3 个框架候选**（A/B/C）；每个候选写清框架名、分几节、每节任务、逻辑链、适用场景/风险，用 \`gongwen_draft action=frames\` 保存，等用户选定后再 \`select_frame\`。
3. 第一轮回答同时讲清五件事：**重心**（这篇稿子到底要解决什么）、**主题结构**（分几节）、**题目**（是否准确、要不要改）、**小标题**（每节标题和任务）、**逻辑链**（节与节之间为什么这样排）。三个候选要体现结构差异，不能只换标题。
4. 最后只问 1-3 个必须由用户确认的问题（文种、受众/讲话人、必须写/不能写，以及选哪个框架）。用户选定前不要写正文。

### 写作任务书（动笔前必须形成）
先确认，缺什么问什么，一次不超过 3 项；用户给不出就留“[待补：xx]”，不得编造人名、职务、数据、文号、政策名称。
- **文种**：函/通知/请示/报告/纪要/讲话/方案等。不同文种字数不同，先看 \`guide\` 的 wordRange，不要一概写长。
- **受众/讲话人**：对下、对上、平行单位、社会公众；讲话稿必须问清讲话人身份（局长/县长/书记/分管领导）和听众，局长偏业务部署，县长偏全局统筹，语气和篇幅不同。
- **重心**：用一句话写下来（\`focus\`）。函通常只办一件事；请示一文一事；报告按“情况—做法—成效—问题—打算”；讲话可以多事项，但必须有一个主基调统摄，不能并列堆砌。
- **必须写/不能写**：\`keyPoints\`、\`mustInclude\`、\`avoid\`。写作全程拿它对照，每一节都要回答“这一节为重心做了什么”。

### 检索：首次出框架必查，其他按需
写新稿、第一次出框架前必须主动联网检索；其他时候只在用户明确说“检索/参考/找范文/学习写法/查政策”时调用 \`gongwen_research\`，已有稿推敲、局部修改等场景不要主动联网。
- 检索只用官网（人民网、共产党员网、中国政府网、党建网、中国新闻网、旗帜网、人民论坛网），学结构、提法、语气，不照抄。
- 官方微信公众号：用 \`gongwen_research action=search sources:["wechat"] query=...\` 发现 mp.weixin.qq.com 文章，再用 \`action=read url=...\` 打开并核验公众号是否在白名单。微信读取会请求确认并调用本地 Chrome；账号不在白名单的，不按官方材料保存。本单位/本地官方账号名可通过 \`wechatAccounts\` 补充。
- 官网栏目页打不开或用户给的是微信链接时，才用 \`gongwen_browser\`：它会先请求用户确认，打开本地 Chrome，读完正文自动关闭；用户拒绝就改用 \`web_fetch\` 或请用户粘贴正文。

首次出框架的检索要求：
- 至少查 2-3 组关键词：文种+主题、主题+年份/地域、同类范文/政策依据；优先政府官网，必要时加官方微信公众号。
- 检索结果只用于校准政策依据、结构、提法和风险，不照抄；把来源标题和要点记入 frameResearch。
- 检索后必须给 3 个结构明显不同的候选：例如“部署型（按任务分节）”“问题型（按问题—原因—对策）”“保障型（按组织领导—重点任务—督查考核）”。
- 每个候选都要写：标题、分节、每节任务、逻辑链、适用场景、风险。等用户选定一个后再写正文。

### 政治性表述核查：发布前必须做
- 凡涉及会议时间、会议名称/届次、领导人姓名职务、重要讲话精神、重要指示、文件号、固定提法，必须调用 \`gongwen_factcheck action=check\`。
- 只认政府机关官网（.gov.cn、npc.gov.cn、cppcc.gov.cn、ccdi.gov.cn、court.gov.cn、spp.gov.cn、mfa.gov.cn 等）和人民网、共产党员网、新华社、求是网、央视网等官方来源的正文。搜索摘要只能用来找线索，不能当证据。
- 先 \`action=scan\` 看有哪些高风险表述；再 \`action=check\` 抓官方原文逐条比对。默认只报告，不改正文；用户明确要求“直接校正”时才传 \`autoCorrect=true\`，且只自动改有官方原句、可精确替换的日期和文件号。
- P0 未核实、冲突或“需人工复核”的，不得直接发布；报告里必须列出官方链接和原句，交由用户确认。
- 导出前如正文含政治性表述却未核查，\`gongwen_export\` 会提示先核查；核查后正文又改动，需要重新核查。

### 写作与实时打磨稿
- 新建：\`gongwen_draft action=create\` 传标题、文种、发文机关、主送机关、日期、受众/讲话人、重心、必须写/不能写、提纲、正文段落。
- 每次正文变化（create/replace/apply/insert/delete/move）后，插件会自动重写工作区根目录的 **《题目_打磨版.docx》**，并同步一份稳定预览文件；侧边栏“打磨稿”按钮打开一次后，后续修改会自动刷新。
- 首次生成/导入后，调用 \`present\` 把工作区根目录的《题目_打磨版.docx》标为交付物；用户点开文件卡片即可在右侧预览，之后每次修改自动刷新。若页面右上角有“打磨稿”按钮，也可以直接点它。
- 导出/检查：\`gongwen_export action=export\`。P0 必须为 0；占位符要逐条列给用户核对。

### 推敲流程
1. 用户说“开始推敲/修改/审稿/逐段来”时，调用 \`gongwen_polish action=start\`，先只讲结构：总体判断 + 3-5 个结构问题（按 P1→P3）+ 调整方案，等确认。
2. 逐段：一次只处理一段。报“第 N 段（位置/小标题）”，引原文关键句，给 1-3 个改法（推荐版标“建议”，说明理由和风险），等用户选。确认后 \`propose\` + \`apply\`，再 \`next\`。
3. 逐句：用户要“一句一句”时，把当前段拆成句，一次只改一句；保留原意与政策口径，展示“原句→新句+理由”，确认后 \`apply\`。
4. 不跑偏：每次改完对照 \`focus\` 和文种画像检查——函/请示是否多事、讲话是否没有主基调、报告是否缺问题/打算、字数是否严重偏离区间。

### 记忆：多轮打磨不丢上下文
- 继续已有项目前，先 \`gongwen_memory action=get\`（或 \`gongwen_polish action=status\`），
  用摘要里的重心、结构、已定事项、待办恢复上下文。
- 每完成一个结构段、或用户说“先这样/暂停/记住”，调用 \`gongwen_memory action=save\` 写 300 字内阶段总结、已定事项、待办；不要依赖原始聊天记录。

### 推敲纪律
- 一次只推进一个决策点；给选项，不让用户凭空想措辞。
- 未经用户确认不落笔；用户说“你定/按推荐改/直接改”时可连续应用推荐方案，但每次仍展示改动摘要。
- 用户提供的事实、数字、口径优先于检索材料；冲突时标注并请用户确认。
- 不改变文种和行文方向；不把请示写成报告，不在一份请示里写多件事。
- 引用官网材料时在推敲说明中注明“参考：标题（来源）”，正文不出现网址。`;

const STORES = new Map();

function workspaceFor(ctx, exec) {
  try {
    const sessions = ctx.get("sessions");
    const wd = ctx.get("workingDirectory");
    if (sessions && wd && exec?.agent) {
      const session = sessions.get(exec.agent.id);
      if (session) return wd.get(session);
    }
    if (wd?.defaultDirectory) return wd.defaultDirectory;
  } catch {
    // 服务缺失时回退
  }
  return process.cwd();
}

function storeFor(ctx, exec) {
  const workspace = workspaceFor(ctx, exec);
  if (!STORES.has(workspace)) STORES.set(workspace, new ProjectStore(workspace));
  return STORES.get(workspace);
}

function fail(error) {
  return { success: false, error: String(error?.message || error) };
}

function renderResult(_args, value) {
  if (typeof value === "string") return [{ type: "text", text: value }];
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

const OUTPUT = {
  schema: { type: "object", additionalProperties: true },
  render: renderResult,
};

const PROJECT_PARAM = {
  type: "string",
  description: "项目 id 或 latest；省略时使用当前工作区最近更新的项目。",
};

function missingFields(project) {
  const missing = [];
  if (!project.title) missing.push("标题");
  if (!project.issuer) missing.push("发文机关");
  if (!project.recipient) missing.push("主送机关");
  if (!project.date) missing.push("成文日期");
  if (!project.outline?.length) missing.push("结构提纲");
  if (!project.paragraphs?.length) missing.push("正文段落");
  if (!project.focus) missing.push("重心");
  if (project.docType === "speech" && !project.speaker && !project.speakerRole) missing.push("讲话人身份");
  return missing;
}

async function refreshPreview(ctx, exec, project, store) {
  try {
    const workspace = workspaceFor(ctx, exec);
    const preview = await renderNative(project, store, {
      workspace,
      signal: exec.signal,
      check: true,
      aiDeclaration: false,
    });
    if (preview.ok) {
      project.preview = preview;
      store.save(project);
      return preview;
    }
    return { ok: false, error: preview.error };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function applySafeFactCorrections(store, project, checked) {
  const byParagraph = new Map();
  const skipped = [];
  for (const claim of checked) {
    const correction = claim.correction;
    if (!correction?.safe || !correction.replacement || !claim.paragraphId) continue;
    if (!Number.isInteger(correction.from) || !Number.isInteger(correction.to)) continue;
    if (!byParagraph.has(claim.paragraphId)) byParagraph.set(claim.paragraphId, []);
    byParagraph.get(claim.paragraphId).push({
      ...correction,
      claimId: claim.id,
      official: claim.official?.[0]?.url || "",
    });
  }

  const applied = [];
  for (const [paragraphId, corrections] of byParagraph) {
    const paragraph = project.paragraphs.find((p) => p.id === paragraphId);
    if (!paragraph) {
      skipped.push({ paragraphId, claimIds: corrections.map((c) => c.claimId), reason: "段落不存在" });
      continue;
    }
    const before = paragraph.text;
    let text = before;
    let lastFrom = Infinity;
    const used = [];
    for (const correction of corrections.slice().sort((a, b) => b.from - a.from)) {
      if (correction.to > lastFrom) {
        skipped.push({ paragraphId, claimId: correction.claimId, reason: "修改位置重叠" });
        continue;
      }
      if (text.slice(correction.from, correction.to) !== before.slice(correction.from, correction.to)) {
        skipped.push({ paragraphId, claimId: correction.claimId, reason: "原文位置已变化" });
        continue;
      }
      text = `${text.slice(0, correction.from)}${correction.replacement}${text.slice(correction.to)}`;
      lastFrom = correction.from;
      used.push(correction);
    }
    if (!used.length || text === before) continue;
    try {
      const result = applyRevision(store, project, {
        paragraph: paragraphId,
        newText: text,
        scope: "paragraph",
        note: `政治事实自动校正（${used.map((c) => c.claimId).join("、")}）：只替换官方明确给出的日期/文件号，来源见 factcheck.md。`,
      });
      applied.push({
        paragraphId,
        claimIds: used.map((c) => c.claimId),
        before,
        after: text,
        official: used.map((c) => c.official).filter(Boolean),
        revision: result.revision,
      });
    } catch (error) {
      skipped.push({ paragraphId, claimIds: used.map((c) => c.claimId), reason: String(error?.message || error) });
    }
  }
  return { applied, skipped };
}

function guessDocType(title) {
  const t = String(title || "");
  if (/通知/.test(t)) return "notice";
  if (/请示/.test(t)) return "request";
  if (/报告/.test(t)) return "report";
  if (/函/.test(t)) return "letter";
  if (/纪要/.test(t)) return "minutes";
  if (/讲话|发言/.test(t)) return "speech";
  if (/方案|计划/.test(t)) return "work_plan";
  if (/意见/.test(t)) return "opinion";
  if (/批复/.test(t)) return "reply";
  if (/决定/.test(t)) return "decision";
  if (/总结/.test(t)) return "summary";
  if (/公告|通告/.test(t)) return "announcement";
  return "notice";
}

function parseTextParagraphs(text) {
  const lines = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s*/, "").trim())
    .filter(Boolean);
  const out = [];
  for (const line of lines) {
    out.push(line);
  }
  return out;
}

async function importIntoProject(ctx, exec, store, args) {
  const workspace = workspaceFor(ctx, exec);
  const input = String(args.path || "");
  if (!input) throw new Error("import 需要 path（.docx/.md/.txt 路径）。");
  const absolute = isAbsolute(input) ? input : resolve(workspace, input);
  if (!existsSync(absolute)) throw new Error(`文件不存在：${absolute}`);
  const ext = absolute.toLowerCase().split(".").pop();
  let rawParagraphs = [];
  let rawMeta = [];
  let title = "";
  if (ext === "docx") {
    const data = await extractDocx(absolute, { signal: exec.signal });
    if (!data.ok) throw new Error(data.error || "解析 .docx 失败");
    const extracted = data.paragraphs || [];
    rawParagraphs = extracted.map((p) => p.text).filter(Boolean);
    rawMeta = extracted.filter((p) => p.text).map((p) => ({ tabs: Array.isArray(p.tabs) ? p.tabs : [] }));
  } else {
    rawParagraphs = parseTextParagraphs(readFileSync(absolute, "utf8"));
    rawMeta = rawParagraphs.map(() => ({ tabs: [] }));
  }
  if (!rawParagraphs.length) throw new Error("文件里没有可导入的段落。");

  // 识别标题、主送机关、日期、落款
  const dateRe = /^\s*20\d{2}年\d{1,2}月\d{1,2}日\s*$/;
  const recipientRe = /[：:]\s*$/;
  let titleIdx = 0;
  if (rawParagraphs[0]?.length <= 80 && !/[。；]/.test(rawParagraphs[0]) && /(关于|通知|报告|请示|函|纪要|讲话|方案|意见|决定|批复|总结|公告)/.test(rawParagraphs[0])) {
    title = rawParagraphs[0];
    titleIdx = 1;
  }
  let recipient = "";
  if (rawParagraphs[titleIdx] && recipientRe.test(rawParagraphs[titleIdx]) && rawParagraphs[titleIdx].length <= 60) {
    recipient = rawParagraphs[titleIdx].replace(/[：:]\s*$/, "");
    titleIdx += 1;
  }
  const dateIdx = rawParagraphs.findIndex((t) => dateRe.test(t));
  const date = dateIdx >= 0 ? rawParagraphs[dateIdx].trim() : "";
  let issuer = "";
  const signatureLines = [];
  if (dateIdx > 0) {
    // 新版渲染器的落款带制表位：首行右对齐、续行和日期居中。
    // 从日期往前收集连续带制表位的段落，拼回完整单位名称，避免把续行当正文。
    for (let i = dateIdx - 1; i >= titleIdx; i -= 1) {
      if (!rawMeta[i]?.tabs?.length) break;
      signatureLines.unshift(rawParagraphs[i].trim());
    }
    if (signatureLines.length) {
      issuer = signatureLines.join("");
    } else {
      const beforeDate = rawParagraphs[dateIdx - 1]?.trim();
      if (beforeDate && beforeDate.length <= 80 && !/[。；]/.test(beforeDate)) {
        issuer = beforeDate;
        signatureLines.push(beforeDate);
      }
    }
  }
  const signatureSet = new Set(signatureLines.map((t) => t.trim()));

  const body = rawParagraphs.slice(titleIdx).filter((t) => {
    if (dateRe.test(t)) return false;
    if (signatureSet.has(t.trim())) return false;
    if (/内容由.{0,20}AI.{0,10}生成|仅供参考/.test(t)) return false;
    return true;
  });
  const docType = args.docType || guessDocType(title || rawParagraphs[0]);
  const project = store.create({
    title: title || args.title || "未命名公文",
    docType,
    issuer: args.issuer || issuer,
    recipient: args.recipient || recipient,
    date: args.date || date,
    topic: args.topic,
    requirements: args.requirements,
    audience: args.audience,
    speaker: args.speaker,
    speakerRole: args.speakerRole,
    occasion: args.occasion,
    focus: args.focus,
    wordTarget: args.wordTarget,
    keyPoints: args.keyPoints,
    mustInclude: args.mustInclude,
    avoid: args.avoid,
    sourcePath: input,
    paragraphs: body,
  });
  const preview = await refreshPreview(ctx, exec, project, store);
  return {
    project: store.summary(project, { includeParagraphs: true }),
    brief: buildBrief(project),
    preview,
    nextStep: "先不要改正文。把 brief 里的重心、题目、小标题、每节任务、逻辑链讲清楚，等用户确认后再进入结构审。",
  };
}

function draftTool(ctx) {
  return {
    name: "gongwen_draft",
    description:
      "管理公文写作项目：查文种画像、导入已有稿、首轮判读、新建初稿、读取/调整结构与段落。文字由你撰写，本工具只负责保存、编号、统计和实时渲染 Word。写初稿前先用 guide 查文种字数区间/重心/风险；用户给了稿子先 import 再 brief，首轮只讲判读，不改正文。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["guide", "import", "brief", "create", "frames", "select_frame", "get", "list", "update", "set_outline", "replace", "insert", "delete", "move", "render"],
          description:
            "guide 查文种画像；import 导入已有稿（.docx/.md/.txt）；brief 首轮判读（重心/结构/逻辑）；create 新建；frames 保存 2-4 个框架候选；select_frame 选定一个框架生成提纲；get 读项目；list 列项目；update 改元数据；set_outline 改提纲；replace 整体替换正文；insert/delete/move 增删移段；render 只重写 draft.md。",
        },
        project: PROJECT_PARAM,
        path: { type: "string", description: "import 的文件路径（相对工作区或绝对路径）。" },
        title: { type: "string", description: "公文标题（发文机关+事由+文种）。" },
        docType: {
          type: "string",
          description: "文种：notice/request/report/letter/minutes/speech/work_plan/opinion/decision/reply/summary 等。",
        },
        issuer: { type: "string", description: "发文机关全称，用作落款。" },
        recipient: { type: "string", description: "主送机关，多个用顿号或逗号分隔；不要带末尾冒号。" },
        date: { type: "string", description: "成文日期，如 2026年10月21日。" },
        topic: { type: "string", description: "事由/主题，一句话。" },
        requirements: { type: "string", description: "用户要求、素材要点、必须写入的事实。" },
        style: { type: "string", description: "语言风格，默认“务实严谨”。" },
        wordTarget: { type: "number", description: "目标字数；不同文种常规区间不同，先看 guide。" },
        audience: { type: "string", description: "受众是谁（对下、对上、平行单位、社会公众、会场听众）。" },
        speaker: { type: "string", description: "讲话人姓名/职务（讲话稿必填）。" },
        speakerRole: { type: "string", description: "讲话人身份校准：局长/县长/书记/分管领导。" },
        occasion: { type: "string", description: "讲话或行文场合。" },
        focus: { type: "string", description: "这篇稿子的重心，一句话；全程用它防止跑偏。" },
        keyPoints: {
          type: "array",
          description: "必须写到的要点。",
          items: { type: "string" },
        },
        mustInclude: {
          type: "array",
          description: "不可遗漏的事实、数据、政策依据。",
          items: { type: "string" },
        },
        avoid: {
          type: "array",
          description: "明确不能写、不能承诺的内容。",
          items: { type: "string" },
        },
        outline: {
          type: "array",
          description: "结构提纲。元素可为字符串，或 {id,title,intent}。",
          items: { oneOf: [{ type: "string" }, { type: "object", additionalProperties: true }] },
        },
        frames: {
          type: "array",
          description: "首次出框架时的 2-4 个候选。每个含 title、sections（或 outline）、logic、bestFor、risk。",
          items: { type: "object", additionalProperties: true },
        },
        frame: { type: "string", description: "select_frame 的候选 id 或序号，如 F2 / 2。" },
        researchNotes: {
          type: "array",
          description: "本次出框架前检索到的依据/线索，写来源标题和要点，便于回溯。",
          items: { type: "string" },
        },
        paragraphs: {
          type: "array",
          description: "正文段落，按顺序。元素可为字符串，或 {text,role,section}；role 省略时按“一、/（一）/1.”自动识别标题，按“各位同学：/县应急管理局：”自动识别称呼。",
          items: { oneOf: [{ type: "string" }, { type: "object", additionalProperties: true }] },
        },
        paragraph: {
          type: "string",
          description: "目标段落 id（如 P3），用于 insert/delete/move；delete 时必填，insert/move 时配合 before/after。",
        },
        text: { type: "string", description: "insert 的新段落文本。" },
        role: { type: "string", description: "insert 的段落角色：body/heading1/heading2/heading3/heading4/attachment/salutation。" },
        before: { type: "string", description: "插入/移动到该段落 id 之前。" },
        after: { type: "string", description: "插入/移动到该段落 id 之后。" },
      },
      required: ["action"],
    },
    output: OUTPUT,
    async execute(args, exec) {
      try {
        const store = storeFor(ctx, exec);
        const action = args.action;
        if (action === "guide") {
          const key = String(args.docType || "notice");
          const checklist = STRUCTURE_CHECKLISTS[key] || STRUCTURE_CHECKLISTS.default;
          return {
            success: true,
            docType: key,
            profile: profileSummary(key),
            sections: checklist.sections,
            extra: checklist.extra,
            rules: [
              "先定文种，再定字数区间；字数不是越多越好。",
              "讲话稿必须先定讲话人身份和听众，再定语气和篇幅。",
              "先写一句重心，再排结构；每一节都要回答它为中心做什么。",
              "第一次出框架前必须先联网检索，不能凭记忆直接给结构。",
            ],
            nextStep:
              "先联网检索（政府官网为主，必要时官方微信公众号），再给 3 个框架候选；每个写清分节、每节任务、逻辑链、适用场景和风险。用 action=frames 保存，等用户选定后再 select_frame 写正文。",
          };
        }
        if (action === "import") {
          return { success: true, ...(await importIntoProject(ctx, exec, store, args)) };
        }
        if (action === "list") {
          return { success: true, projects: store.list() };
        }
        if (action === "create") {
          const project = store.create(args);
          const preview = project.paragraphs.length ? await refreshPreview(ctx, exec, project, store) : null;
          return {
            success: true,
            project: store.summary(project),
            profile: profileSummary(project.docType),
            warnings: [
              ...validateProfile(project),
              ...(project.paragraphs.length && !project.selectedFrame
                ? ["正文已直接写入，未经过“联网检索 + 3 个框架候选”的首次出框架流程。"]
                : []),
            ],
            missing: missingFields(project),
            preview,
            nextStep:
              project.paragraphs.length > 0
                ? "初稿已保存并生成《题目_打磨版.docx》。先调用 brief 做首轮判读，再进入结构审。"
                : "项目已建。先联网检索，再用 action=frames 保存 2-4 个框架候选，等用户选定后写正文。",
          };
        }
        if (action === "frames") {
          if (!Array.isArray(args.frames) || args.frames.length < 2) {
            throw new Error("frames 需要至少 2 个候选框架（建议 3 个）。");
          }
          if (!Array.isArray(args.researchNotes) || !args.researchNotes.length) {
            throw new Error("frames 需要 researchNotes：先联网检索，把来源标题和要点传进来，再保存框架候选。");
          }
          const updated = store.setFrames(store.load(args.project), args.frames, {
            researchNotes: args.researchNotes,
          });
          return {
            success: true,
            frames: updated.frameCandidates,
            researchNotes: updated.frameResearch,
            nextStep:
              "把 3 个框架候选的差别讲清楚，推荐一个并说明理由；等用户选定后调用 select_frame，再写正文。",
          };
        }
        if (action === "select_frame") {
          if (!args.frame) throw new Error("select_frame 需要 frame（如 F2 或 2）。");
          const updated = store.selectFrame(store.load(args.project), args.frame);
          return {
            success: true,
            selectedFrame: updated.selectedFrame,
            outline: updated.outline,
            project: store.summary(updated),
            nextStep: "框架已选定。现在按 outline 写正文；写完用 action=replace 保存全部段落。",
          };
        }
        const project = store.load(args.project);
        if (action === "brief") {
          return {
            success: true,
            brief: buildBrief(project),
            digest: buildDigest(project),
            frames: project.frameCandidates || [],
            selectedFrame: project.selectedFrame || "",
            preview: project.preview,
            nextStep: "先不要改正文。把重心、题目、小标题、每节任务和逻辑链讲给用户听，等确认。",
          };
        }
        if (action === "get") {
          return {
            success: true,
            project: store.summary(project, { includeParagraphs: true }),
            digest: buildDigest(project),
          };
        }
        if (action === "update") {
          const updated = store.update(project, args);
          const preview = updated.paragraphs.length ? await refreshPreview(ctx, exec, updated, store) : null;
          return { success: true, project: store.summary(updated, { includeParagraphs: true }), preview };
        }
        if (action === "set_outline") {
          const updated = store.update(project, { outline: args.outline || [] });
          return { success: true, outline: updated.outline, project: store.summary(updated) };
        }
        if (action === "replace") {
          if (!Array.isArray(args.paragraphs)) throw new Error("replace 需要 paragraphs 数组。");
          const updated = store.replaceParagraphs(project, args.paragraphs);
          const preview = await refreshPreview(ctx, exec, updated, store);
          return {
            success: true,
            project: store.summary(updated, { includeParagraphs: true }),
            preview,
            message: "正文已整体替换，段落重新编号，推敲进度已重置。",
          };
        }
        if (action === "insert") {
          const p = store.insertParagraph(project, {
            text: args.text,
            role: args.role,
            after: args.after || (args.before ? undefined : args.paragraph),
            before: args.before,
          });
          const preview = await refreshPreview(ctx, exec, project, store);
          return { success: true, paragraph: p, project: store.summary(project), preview };
        }
        if (action === "delete") {
          const p = store.deleteParagraph(project, args.paragraph);
          const preview = await refreshPreview(ctx, exec, project, store);
          return { success: true, removed: p, project: store.summary(project), preview };
        }
        if (action === "move") {
          const p = store.moveParagraph(project, args.paragraph, { before: args.before, after: args.after });
          const preview = await refreshPreview(ctx, exec, project, store);
          return { success: true, moved: p, project: store.summary(project), preview };
        }
        if (action === "render") {
          const path = store.writeMarkdown(project);
          const preview = await refreshPreview(ctx, exec, project, store);
          return { success: true, path, preview, paragraphs: project.paragraphs.length };
        }
        throw new Error(`未知 action：${action}`);
      } catch (error) {
        return fail(error);
      }
    },
  };
}

function researchTool(ctx) {
  return {
    name: "gongwen_research",
    description:
      "检索并保存官方范文/政策材料：人民网、共产党员网、中国政府网、党建网、中国新闻网、旗帜网、人民论坛网，以及官方微信公众号。网站材料只从官网取；微信结果先用 search 发现 mp.weixin.qq.com 线索，再用 read 打开并核验公众号白名单。search 扫描网站栏目或检索官方公众号；read 抓取单篇正文并存入参考库；list 查看已存材料。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["search", "read", "list", "remove"],
          description: "search 检索目录；read 精读单篇；list 列出项目已存材料；remove 删除参考材料。",
        },
        project: PROJECT_PARAM,
        query: { type: "string", description: "检索关键词，如“基层治理 减负 通知”。" },
        sources: {
          type: "array",
          description: "检索哪些站点，默认全部。",
          items: { type: "string", enum: Object.keys(SOURCES) },
        },
        maxResults: { type: "number", description: "最多返回几条，1-12，默认 6。" },
        url: { type: "string", description: "read 的官网文章 URL（限 .gov.cn、people.com.cn、12371.cn 等），或 mp.weixin.qq.com 官方公众号文章。" },
        id: { type: "string", description: "remove 的参考材料 id，如 REF1。" },
        save: { type: "boolean", description: "read 时是否存入项目参考库，默认 true。" },
        wechatAccounts: {
          type: "array",
          description: "可选：补充认定为本单位/本地官方的微信公众号名称，加入检索和白名单。",
          items: { type: "string" },
        },
      },
      required: ["action"],
    },
    output: OUTPUT,
    async execute(args, exec) {
      try {
        const action = args.action;
        if (action === "search") {
          if (!args.query) throw new Error("search 需要 query。");
          const maxResults = Math.max(1, Math.min(12, Number(args.maxResults) || 6));
          const requested = Array.isArray(args.sources) && args.sources.length
            ? args.sources
            : Object.keys(SOURCES).filter((key) => key !== "wechat");
          const regularSources = requested.filter((key) => key !== "wechat" && SOURCES[key]);
          const wantsWechat = requested.includes("wechat");
          let regular = { query: args.query, results: [], errors: [], note: "" };
          if (regularSources.length) {
            regular = await searchOfficial({
              query: args.query,
              sources: regularSources,
              maxResults,
              signal: exec.signal,
            });
          }
          let wechat = null;
          if (wantsWechat) {
            wechat = await searchWechat({
              query: args.query,
              web: ctx.get("web"),
              accounts: args.wechatAccounts,
              maxResults,
              signal: exec.signal,
            });
          }
          if (!wechat) return { success: true, ...regular };
          return {
            success: true,
            query: args.query,
            results: [...(regular.results || []), ...wechat.results].slice(0, maxResults * 2),
            errors: [...(regular.errors || []), ...wechat.errors],
            note: [regular.note, wechat.note].filter(Boolean).join("；"),
            wechat: { accounts: wechat.accounts, note: wechat.note },
          };
        }
        if (action === "read") {
          if (!args.url) throw new Error("read 需要 url。");
          if (isWechatArticleUrl(args.url)) {
            const approval = ctx.get("approval");
            if (!approval?.request) {
              return { success: false, error: "当前环境没有确认服务，出于安全考虑不打开本地浏览器读取微信文章。" };
            }
            const outcome = await approval.request({
              agent: exec.agent,
              toolName: "gongwen_research",
              callId: exec.callId,
              reason: `打开本地 Chrome 读取微信公众号文章并核验账号：${args.url}`,
              signal: exec.signal,
            });
            if (outcome !== "allowed-once") {
              return { success: false, error: "用户未批准打开浏览器，已取消。", outcome };
            }
            const wechatArticle = await readWechat(args.url, {
              workspace: workspaceFor(ctx, exec),
              waitMs: 3000,
              signal: exec.signal,
              accounts: args.wechatAccounts,
            });
            if (!wechatArticle.officialAccount) {
              return {
                success: false,
                error: `公众号“${wechatArticle.accountName}”不在官方白名单，不能作为官方材料保存。如确属你单位官方账号，请在 wechatAccounts 中显式加入后重试。`,
                article: {
                  title: wechatArticle.title,
                  accountName: wechatArticle.accountName,
                  userName: wechatArticle.userName,
                  biz: wechatArticle.biz,
                  url: wechatArticle.url,
                  publishTime: wechatArticle.publishTime,
                  officialAccount: false,
                },
              };
            }
            let saved = null;
            let saveError = null;
            if (args.save !== false) {
              try {
                const store = storeFor(ctx, exec);
                let project = null;
                try {
                  project = store.load(args.project);
                } catch {
                  project = null;
                }
                if (project) {
                  saved = store.addReference(project, {
                    ...wechatArticle,
                    source: wechatArticle.sourceLabel,
                    date: wechatArticle.publishTime,
                  });
                }
              } catch (error) {
                saveError = String(error?.message || error);
              }
            }
            return {
              success: true,
              article: {
                title: wechatArticle.title,
                source: wechatArticle.sourceLabel,
                accountName: wechatArticle.accountName,
                officialAccount: true,
                url: wechatArticle.url,
                date: wechatArticle.publishTime,
                chars: wechatArticle.chars,
                excerpt: wechatArticle.excerpt,
                text: wechatArticle.text.slice(0, 8000),
                truncated: wechatArticle.text.length > 8000,
              },
              saved,
              saveError,
              nextStep: saved
                ? "已核验为官方公众号并存入参考库。只学结构与提法，不照抄。"
                : "已核验为官方公众号，但未找到可写入的项目；材料仅本次返回。",
            };
          }
          const article = await readOfficial(args.url, { signal: exec.signal });
          let saved = null;
          let saveError = null;
          const shouldSave = args.save !== false;
          if (shouldSave) {
            try {
              const store = storeFor(ctx, exec);
              let project = null;
              try {
                project = store.load(args.project);
              } catch {
                project = null;
              }
              if (project) saved = store.addReference(project, article);
            } catch (error) {
              saveError = String(error?.message || error);
            }
          }
          return {
            success: true,
            article: {
              title: article.title,
              source: article.sourceLabel,
              url: article.url,
              date: article.date,
              chars: article.chars,
              excerpt: article.excerpt,
              text: article.text.slice(0, 8000),
              truncated: article.text.length > 8000,
            },
            saved,
            saveError,
            nextStep: saved ? "材料已存入参考库。写稿时只学结构与提法，不照抄。" : "未找到可写入的项目；材料仅本次返回。",
          };
        }
        const store = storeFor(ctx, exec);
        const project = store.load(args.project);
        if (action === "list") {
          return { success: true, references: project.references };
        }
        if (action === "remove") {
          if (!args.id) throw new Error("remove 需要 id。");
          const removed = store.removeReference(project, args.id);
          return { success: true, removed };
        }
        throw new Error(`未知 action：${action}`);
      } catch (error) {
        return fail(error);
      }
    },
  };
}

function polishTool(ctx) {
  return {
    name: "gongwen_polish",
    description:
      "逐层推敲公文：先结构、再段落、再句子，记录每处采纳/放弃的修改。start 生成结构诊断包；next 取下一段或下一句；propose 登记候选改法；apply 落笔并记修订；skip 跳过；finish 收尾。修改前必须先征得用户同意——本工具不会自动改写。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["start", "structure", "next", "show", "focus", "propose", "apply", "discard", "skip", "finish", "status", "rewind", "history"],
          description:
            "start 开始结构审；structure 记录结构方案；next 下一项；show 查看当前项；focus 跳到某段/某句；propose 登记候选改法；apply 应用；discard 放弃候选；skip 跳过；finish 收尾；status 进度；rewind 回退；history 修订记录。",
        },
        project: PROJECT_PARAM,
        paragraph: { type: "string", description: "段落 id（如 P3）或 1 起的段序号；省略时用当前光标。" },
        sentence: { type: "number", description: "句子序号，从 0 开始；传了就按句处理。" },
        scope: { type: "string", enum: ["paragraph", "sentence"], description: "apply 的范围；省略时按 sentence 是否存在推断。" },
        newText: { type: "string", description: "apply 的新文本（整段或整句）。" },
        option: { type: "number", description: "apply 时选 pending.options 的序号，从 0 开始；省略则用 newText。" },
        options: {
          type: "array",
          description: "propose 的候选改法，1-3 个，推荐项放第一。元素可为字符串或 {text,note}。",
          items: { oneOf: [{ type: "string" }, { type: "object", additionalProperties: true }] },
        },
        note: { type: "string", description: "修改理由/审稿意见，会记入修订历史。" },
        summary: { type: "string", description: "structure 时记录已与用户确认的结构调整方案。" },
        outline: {
          type: "array",
          description: "structure 时更新提纲。元素可为字符串或 {id,title,intent}。",
          items: { oneOf: [{ type: "string" }, { type: "object", additionalProperties: true }] },
        },
        paragraphOrder: {
          type: "array",
          description: "structure 时按 id 重排段落顺序，如 [\"P1\",\"P3\",\"P2\"]。",
          items: { type: "string" },
        },
        force: { type: "boolean", description: "finish 时跳过“仍有段落未过”的确认。" },
        includeCompleted: { type: "boolean", description: "next 时是否把已过段落也纳入推进，默认 false。" },
      },
      required: ["action"],
    },
    output: OUTPUT,
    async execute(args, exec) {
      try {
        const store = storeFor(ctx, exec);
        const project = store.load(args.project);
        const action = args.action;
        if (action === "start") return { success: true, ...startReview(store, project) };
        if (action === "structure") {
          return {
            success: true,
            ...recordStructure(store, project, {
              summary: args.summary,
              outline: args.outline,
              paragraphOrder: args.paragraphOrder,
            }),
          };
        }
        if (action === "next") {
          return { success: true, ...nextItem(store, project, { includeCompleted: Boolean(args.includeCompleted) }) };
        }
        if (action === "show") {
          return { success: true, ...showItem(store, project, { paragraph: args.paragraph, sentence: args.sentence }) };
        }
        if (action === "focus") {
          return { success: true, ...focusItem(store, project, { paragraph: args.paragraph, sentence: args.sentence, scope: args.scope }) };
        }
        if (action === "propose") {
          return {
            success: true,
            ...propose(store, project, {
              paragraph: args.paragraph,
              sentence: args.sentence,
              scope: args.scope,
              options: args.options,
              note: args.note,
            }),
          };
        }
        if (action === "apply") {
          const result = applyRevision(store, project, {
            paragraph: args.paragraph,
            sentence: args.sentence,
            scope: args.scope,
            newText: args.newText,
            option: args.option,
            note: args.note,
          });
          const preview = result.revision ? await refreshPreview(ctx, exec, project, store) : null;
          return { success: true, ...result, preview };
        }
        if (action === "discard") return { success: true, ...discardPending(store, project) };
        if (action === "skip") return { success: true, ...skipItem(store, project, { paragraph: args.paragraph, note: args.note }) };
        if (action === "finish") {
          const result = finishReview(store, project, { force: Boolean(args.force) });
          if (result.success) {
            const preview = await refreshPreview(ctx, exec, project, store);
            return { success: true, ...result, preview };
          }
          return result;
        }
        if (action === "status") {
          return { success: true, ...getStatus(store, project), digest: buildDigest(project) };
        }
        if (action === "rewind") return { success: true, ...rewindItem(store, project) };
        if (action === "history") return { success: true, ...getHistory(store, project, { paragraph: args.paragraph }) };
        throw new Error(`未知 action：${action}`);
      } catch (error) {
        return fail(error);
      }
    },
  };
}

function memoryTool(ctx) {
  return {
    name: "gongwen_memory",
    description:
      "管理公文项目的长期记忆：get 取压缩后的项目摘要（重心、结构、进度、已定事项、待办），save 把本阶段的决定和待办写进记忆，brief 取首轮判读包。继续多轮推敲前先 get，避免忘记前面改了什么。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["get", "save", "brief"], description: "get 取记忆；save 写记忆；brief 首轮判读。" },
        project: PROJECT_PARAM,
        summary: { type: "string", description: "save 时写入的阶段总结，建议 300 字以内。" },
        decisions: {
          type: "array",
          description: "save 时追加的已定事项，如“标题定为……”“第二部分压到 300 字”。",
          items: { type: "string" },
        },
        openIssues: {
          type: "array",
          description: "save 时追加的待办/风险。",
          items: { type: "string" },
        },
        focus: { type: "string", description: "save 时校正重心。" },
        keyPoints: { type: "array", description: "save 时校正必须写到的要点。", items: { type: "string" } },
      },
      required: ["action"],
    },
    output: OUTPUT,
    async execute(args, exec) {
      try {
        const store = storeFor(ctx, exec);
        const project = store.load(args.project);
        if (args.action === "brief") {
          return { success: true, brief: buildBrief(project), digest: buildDigest(project) };
        }
        if (args.action === "save") {
          if (args.focus !== undefined) project.focus = String(args.focus || "");
          if (Array.isArray(args.keyPoints)) {
            project.keyPoints = args.keyPoints.map((x) => String(x || "")).filter(Boolean);
          }
          if (args.summary !== undefined) project.memory.summary = String(args.summary || "");
          if (Array.isArray(args.decisions)) {
            for (const d of args.decisions) {
              const text = String(d || "").trim();
              if (text) project.memory.decisions.push({ text, at: new Date().toISOString() });
            }
          }
          if (Array.isArray(args.openIssues)) {
            for (const d of args.openIssues) {
              const text = String(d || "").trim();
              if (text) project.memory.openIssues.push({ text, at: new Date().toISOString() });
            }
          }
          project.memory.updatedAt = new Date().toISOString();
          store.save(project);
        }
        return {
          success: true,
          digest: buildDigest(project),
          memory: project.memory,
          progress: getStatus(store, project).review,
        };
      } catch (error) {
        return fail(error);
      }
    },
  };
}

function browserTool(ctx) {
  return {
    name: "gongwen_browser",
    description:
      "用本地 Chrome 打开普通请求打不开的参考资料（如微信公众号），读取正文后自动关闭标签和浏览器。打开前会请求用户确认；用户拒绝则不启动。仅在用户提供链接且明确允许时使用。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["open", "close", "status"], description: "open 打开并读取后关闭；close 关闭残留浏览器；status 检查 Chrome/确认服务。" },
        url: { type: "string", description: "open 时要打开的 http/https 链接。" },
        headless: { type: "boolean", description: "是否无头运行，默认 false（可看到窗口，读完自动关闭）。" },
        waitMs: { type: "number", description: "页面加载后额外等待毫秒数，默认 3000。" },
      },
      required: ["action"],
    },
    output: OUTPUT,
    async execute(args, exec) {
      try {
        if (args.action === "status") {
          return {
            success: true,
            chrome: findChrome(),
            approval: Boolean(ctx.get("approval")),
          };
        }
        if (args.action === "close") {
          closeBrowser();
          return { success: true, closed: true };
        }
        if (args.action !== "open") throw new Error(`未知 action：${args.action}`);
        if (!args.url) throw new Error("open 需要 url。");
        const approval = ctx.get("approval");
        if (!approval?.request) {
          return { success: false, error: "当前环境没有确认服务，出于安全考虑不打开浏览器。" };
        }
        const outcome = await approval.request({
          agent: exec.agent,
          toolName: "gongwen_browser",
          callId: exec.callId,
          reason: `打开本地 Chrome 读取参考资料：${args.url}`,
          signal: exec.signal,
        });
        if (outcome !== "allowed-once") {
          return { success: false, error: "用户未批准打开浏览器，已取消。", outcome };
        }
        const workspace = workspaceFor(ctx, exec);
        const result = await openAndRead(args.url, {
          workspace,
          headless: Boolean(args.headless),
          waitMs: Math.max(0, Math.min(15000, Number(args.waitMs) || 3000)),
          signal: exec.signal,
        });
        return {
          ...result,
          success: Boolean(result.ok),
          note: "读取完成，已自动关闭 Chrome 标签。",
        };
      } catch (error) {
        return fail(error);
      }
    },
  };
}

function factClaimView(claim, { checked = false } = {}) {
  const view = {
    id: claim.id,
    kind: claim.kind,
    kindLabel: claim.kindLabel,
    risk: claim.risk,
    riskLabel: claim.riskLabel,
    subject: claim.subject,
    assertedDate: claim.assertedDate ? { text: claim.assertedDate.text, start: claim.assertedDate.start, end: claim.assertedDate.end } : null,
    sentenceText: claim.sentenceText,
    paragraphId: claim.paragraphId || "",
    paragraphIndex: claim.paragraphIndex,
    query: claim.query,
    reason: claim.reason,
  };
  if (checked) {
    view.verdict = claim.verdict;
    view.confidence = claim.confidence;
    view.finding = claim.finding;
    view.needsHuman = claim.needsHuman;
    view.official = (claim.official || []).map((x) => ({
      title: x.title,
      url: x.url,
      source: x.source,
      date: x.date,
      quote: x.quote,
      match: x.match,
    }));
    view.correction = claim.correction
      ? {
          text: claim.correction.text,
          replacement: claim.correction.replacement,
          safe: claim.correction.safe,
          note: claim.correction.note,
        }
      : null;
    view.searchQueries = claim.searchQueries;
    view.searchErrors = claim.searchErrors;
    view.fetchErrors = claim.fetchErrors;
  }
  return view;
}

function factcheckTool(ctx) {
  return {
    name: "gongwen_factcheck",
    description:
      "政治性表述核查：扫描并联网核对会议时间、会议名称/届次、领导人职务、重要讲话精神、重要指示、文件号和固定提法。只采信政府机关官网及人民网、共产党员网、新华社等官方来源的正文；搜索摘要不作为证据。scan 只扫描不联网；check 逐条检索并给出已核实/冲突/未核实/需人工结论；verify 用指定官方链接核对一条表述。默认只报告不改正文；autoCorrect=true 只自动替换官方明确、可精确替换的日期和文件号。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["scan", "check", "verify"],
          description: "scan 扫描高风险表述；check 联网核查；verify 用指定官方链接核对。",
        },
        project: PROJECT_PARAM,
        text: { type: "string", description: "可选：直接核查一段文字，不必先建项目。" },
        claim: { type: "string", description: "verify 时要核对的原句或短语。" },
        url: { type: "string", description: "verify 时指定的官方文章 URL。" },
        maxClaims: { type: "number", description: "最多核查几条，1-20，默认 8。" },
        maxSources: { type: "number", description: "每条最多抓取几个官方页面，1-5，默认 3。" },
        autoCorrect: {
          type: "boolean",
          description: "是否自动应用“有官方原句、可精确替换”的日期/文件号修正，默认 false。",
        },
        saveReport: { type: "boolean", description: "是否把核查报告写入项目目录，默认 true。" },
        wechatAccounts: {
          type: "array",
          description: "可选：verify 微信公众号文章时，补充认定为本单位/本地官方的账号名称。",
          items: { type: "string" },
        },
      },
      required: ["action"],
    },
    output: OUTPUT,
    async execute(args, exec) {
      try {
        const action = args.action;
        if (action === "scan" || action === "check") {
          const store = storeFor(ctx, exec);
          let project = null;
          if (!args.text || args.project !== undefined) {
            try {
              project = store.load(args.project);
            } catch (error) {
              if (!args.text) throw error;
            }
          }
          if (!project && !String(args.text || "").trim()) {
            throw new Error("scan/check 需要 project 或 text。");
          }
          const maxClaims = Math.max(1, Math.min(20, Number(args.maxClaims) || 8));
          const scan = extractClaims(
            { project: project || undefined, text: args.text || "" },
            { maxClaims },
          );
          const projectView = project ? { id: project.id, title: project.title, docType: project.docType } : null;
          if (action === "scan") {
            return {
              success: true,
              action: "scan",
              project: projectView,
              total: scan.total,
              sentences: scan.sentences,
              summary: scan.summary,
              truncated: scan.truncated,
              claims: scan.claims.map((c) => factClaimView(c)),
              policy: "只扫描，不联网；check 才会抓官方页面。",
              nextStep: scan.claims.length
                ? "先看 P0/P1 清单；确认后再 action=check 逐条核查。"
                : "未发现需要联网核查的政治性表述。",
            };
          }
          if (!scan.claims.length) {
            return {
              success: true,
              action: "check",
              project: projectView,
              noClaims: true,
              checkedAt: new Date().toISOString(),
              summary: { total: 0, p0: 0, p1: 0, verified: 0, conflict: 0, unverified: 0, needsReview: 0 },
              claims: [],
              reportMarkdown: buildFactReport([], { project, checkedAt: new Date().toISOString() }).markdown,
              nextStep: "未发现需要联网核查的政治性表述；仍建议人工通读一遍。",
            };
          }

          const web = ctx.get("web");
          const checked = await checkClaims(scan.claims, {
            web,
            signal: exec.signal,
            maxSources: Math.max(1, Math.min(5, Number(args.maxSources) || 3)),
            maxResults: 8,
          });
          const checkedAt = new Date().toISOString();
          const report = buildFactReport(checked, { project, checkedAt });
          const autoCorrections = args.autoCorrect && project
            ? applySafeFactCorrections(store, project, checked)
            : { applied: [], skipped: [] };
          let preview = null;
          if (autoCorrections.applied.length) {
            preview = await refreshPreview(ctx, exec, project, store);
          }

          let reportPath = "";
          let reportError = "";
          let openSummary = null;
          let reportMarkdown = report.markdown;
          if (autoCorrections.applied.length) {
            const lines = ["", "## 本次自动校正", ""];
            for (const item of autoCorrections.applied) {
              lines.push(`- 段落 ${item.paragraphId}（${item.claimIds.join("、")}）：`);
              lines.push(`  - 原句：${item.before}`);
              lines.push(`  - 改为：${item.after}`);
              for (const url of item.official || []) lines.push(`  - 依据：${url}`);
            }
            lines.push("");
            lines.push("> 自动校正只替换了官方明确给出的日期/文件号，其他表述仍需人工复核。");
            reportMarkdown += `\n${lines.join("\n")}`;
          }
          if (project) {
            const appliedIds = new Set(autoCorrections.applied.flatMap((x) => x.claimIds));
            const openClaims = checked.filter((c) => !appliedIds.has(c.id) && c.verdict !== "verified");
            openSummary = {
              total: openClaims.length,
              p0: openClaims.filter((c) => c.risk === "P0").length,
              p1: openClaims.filter((c) => c.risk === "P1").length,
              verified: report.summary.verified,
              conflict: openClaims.filter((c) => c.verdict === "conflict").length,
              unverified: openClaims.filter((c) => c.verdict === "unverified").length,
              needsReview: openClaims.filter((c) => c.verdict === "needs_review").length,
            };
            if (args.saveReport !== false) {
              try {
                reportPath = join(store.projectDir(project), "factcheck.md");
                writeFileSync(reportPath, reportMarkdown, "utf8");
                writeFileSync(
                  join(store.projectDir(project), "factcheck.json"),
                  JSON.stringify({ checkedAt, summary: report.summary, openSummary, autoCorrections, claims: checked.map((c) => factClaimView(c, { checked: true })) }, null, 2),
                  "utf8",
                );
              } catch (error) {
                reportError = `报告写入失败：${String(error?.message || error)}`;
              }
            }
            const p0Open = openClaims.filter((c) => c.risk === "P0").length;
            try {
              project.factcheck = {
                checkedAt,
                revisionCount: project.revisions.length,
                summary: openSummary,
                p0Open,
                applied: autoCorrections.applied.map((x) => ({ paragraphId: x.paragraphId, claimIds: x.claimIds })),
                reportPath,
              };
              store.save(project);
            } catch (error) {
              reportError = `${reportError ? `${reportError}；` : ""}核查状态保存失败：${String(error?.message || error)}`;
            }
          }

          return {
            success: true,
            action: "check",
            project: projectView,
            checkedAt,
            policy:
              "仅采用政府机关官网及人民网、共产党员网、新华社等官方来源的正文；搜索摘要不作为证据。P0 未核实/冲突项必须人工复核后才能发布。",
            summary: report.summary,
            openSummary,
            claims: checked.map((c) => factClaimView(c, { checked: true })),
            autoCorrections,
            preview: preview
              ? { ok: preview.ok, docx: preview.docx, stable: preview.stable, check: preview.check }
              : null,
            reportPath: reportPath || "",
            reportError: reportError || "",
            reportMarkdown,
            disclaimer: "机器核查用于辅助，不能替代人工审签；涉及政治性表述的最终口径由用户确认。",
            nextStep:
              (openSummary || report.summary).conflict ||
              (openSummary || report.summary).unverified ||
              (openSummary || report.summary).needsReview
                ? "先处理 P0 冲突/未核实项，再处理 P1 提法；改完重新核查一次再导出。"
                : "本次未发现冲突或未核实项；仍建议人工通读关键段落后再导出。",
          };
        }

        if (action === "verify") {
          if (!args.claim) throw new Error("verify 需要 claim（要核对的原句或短语）。");
          if (!args.url) throw new Error("verify 需要 url（官方文章链接）。");
          const scan = extractClaims({ text: args.claim }, { maxClaims: 5 });
          const claim =
            scan.claims[0] || {
              id: "C1",
              kind: "formulation",
              kindLabel: "重要提法",
              risk: "P1",
              riskLabel: "重要提法",
              subject: String(args.claim).trim(),
              sentenceText: String(args.claim).trim(),
              paragraphId: "",
              paragraphIndex: 0,
              query: `"${String(args.claim).trim()}"`,
              reason: "用户指定核对",
            };
          let checked;
          let wechatAccount = "";
          if (isWechatArticleUrl(args.url)) {
            const approval = ctx.get("approval");
            if (!approval?.request) {
              return { success: false, error: "当前环境没有确认服务，出于安全考虑不打开本地浏览器核对微信文章。" };
            }
            const outcome = await approval.request({
              agent: exec.agent,
              toolName: "gongwen_factcheck",
              callId: exec.callId,
              reason: `打开本地 Chrome 核对微信公众号文章：${args.url}`,
              signal: exec.signal,
            });
            if (outcome !== "allowed-once") {
              return { success: false, error: "用户未批准打开浏览器，已取消。", outcome };
            }
            const article = await readWechat(args.url, {
              workspace: workspaceFor(ctx, exec),
              waitMs: 3000,
              signal: exec.signal,
              accounts: args.wechatAccounts,
            });
            if (!article.officialAccount) {
              return {
                success: false,
                error: `公众号“${article.accountName}”不在官方白名单，不能作为政治性表述核查依据。如确属你单位官方账号，请在 wechatAccounts 中显式加入后重试。`,
                accountName: article.accountName,
              };
            }
            wechatAccount = article.accountName;
            checked = verifyClaimAgainstArticle(
              claim,
              {
                title: article.title,
                text: article.text,
                date: article.publishTime,
                url: article.url,
                sourceLabel: article.sourceLabel,
              },
              { label: `verify-wechat:${args.url}` },
            );
          } else {
            checked = await verifyClaimAtUrl(claim, args.url, { web: ctx.get("web"), signal: exec.signal });
          }
          return {
            success: true,
            action: "verify",
            url: args.url,
            wechatAccount: wechatAccount || "",
            claim: factClaimView(checked, { checked: true }),
            disclaimer: "只核对了你指定的这一个官方页面；如需多源交叉验证，请用 action=check。",
          };
        }

        throw new Error(`未知 action：${action}`);
      } catch (error) {
        return fail(error);
      }
    },
  };
}

function exportTool(ctx) {
  return {
    name: "gongwen_export",
    description:
      "用 gongwen-writer 自带的 GB/T 9704 渲染器生成/检查 Word：每次调用都会重写《题目_打磨版.docx》并做内置格式检查（P0 必须为 0）。不依赖 gongwen-skill。doctor 检查 Python/python-docx 环境。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["export", "doctor"], description: "export 导出并检查；doctor 检查运行环境。" },
        project: PROJECT_PARAM,
        output: { type: "string", description: "可选：另存一份 .docx 的路径；省略时只写工作区根目录的《题目_打磨版.docx》。" },
        aiDeclaration: {
          type: "boolean",
          description: "是否在文末保留“内容由 AI 辅助生成”声明，默认 false。",
        },
      },
      required: ["action"],
    },
    output: OUTPUT,
    async execute(args, exec) {
      try {
        if (args.action === "doctor") {
          return { success: true, ...(await doctorNative()) };
        }
        const store = storeFor(ctx, exec);
        const project = store.load(args.project);
        const workspace = workspaceFor(ctx, exec);
        const factScan = extractClaims({ project }, { maxClaims: 20 });
        const factcheck = project.factcheck;
        const factWarnings = [];
        if (factScan.total > 0) {
          if (!factcheck) {
            factWarnings.push("正文含政治性表述，尚未做官方事实核查。发布前请先运行 gongwen_factcheck action=check。");
          } else if (Number(factcheck.revisionCount) !== project.revisions.length) {
            factWarnings.push("政治性表述核查后正文又有修改，需要重新核查。");
          }
          if (factcheck?.p0Open > 0) {
            factWarnings.push(`上次核查仍有 ${factcheck.p0Open} 条 P0 未核实/冲突，不能直接发布。`);
          }
          if (factcheck?.summary && (factcheck.summary.conflict || factcheck.summary.unverified || factcheck.summary.needsReview)) {
            factWarnings.push(
              `上次核查结果：冲突 ${factcheck.summary.conflict || 0} 条、未核实 ${factcheck.summary.unverified || 0} 条、需人工 ${factcheck.summary.needsReview || 0} 条。`,
            );
          }
        }
        const result = await exportProjectNative(project, store, {
          aiDeclaration: Boolean(args.aiDeclaration),
          signal: exec.signal,
          workspace,
        });
        if (factWarnings.length) {
          result.factcheckWarning = [...new Set(factWarnings)].join("；");
        }
        if (result.success) {
          project.status = result.check?.p0 ? project.status : "finalized";
          store.save(project);
          if (args.output) {
            try {
              const target = isAbsolute(args.output) ? args.output : resolve(workspace, args.output);
              const { copyFileSync } = await import("node:fs");
              copyFileSync(result.docx, target);
              result.exported = target;
            } catch (error) {
              result.exportWarning = `另存失败：${error.message}`;
            }
          }
        }
        return result;
      } catch (error) {
        return fail(error);
      }
    },
  };
}

export const name = "gongwen-writer";
export const description = "公文写作助手：初稿、官网范文检索、政治性表述核查、结构→段落→句子逐层推敲、GB/T 9704 Word 导出";
export const inject = ["tools"];

export function apply(ctx) {
  const disposers = [];
  const sp = ctx.get("systemPrompt");
  if (sp?.section) {
    try {
      const dispose = sp.section({ name: "plugin:gongwen-writer", order: 110, text: PROMPT });
      if (typeof dispose === "function") disposers.push(dispose);
    } catch (error) {
      ctx.logger?.warn?.(`gongwen-writer: system prompt section failed: ${error.message}`);
    }
  }
  if (sp?.context) {
    try {
      const dispose = sp.context({
        name: "plugin:gongwen-writer:memory",
        order: 120,
        text: (assemble) => {
          try {
            const agent = assemble?.scope;
            const sessions = ctx.get("sessions");
            const wd = ctx.get("workingDirectory");
            const session = sessions && agent?.id ? sessions.get(agent.id) : null;
            const workspace = session && wd ? wd.get(session) : wd?.defaultDirectory;
            if (!workspace) return "";
            const store = STORES.get(workspace) || new ProjectStore(workspace);
            const latest = store.latest();
            if (!latest) return "";
            return buildMemoryContext(store.load(latest.id));
          } catch {
            return "";
          }
        },
      });
      if (typeof dispose === "function") disposers.push(dispose);
    } catch (error) {
      ctx.logger?.warn?.(`gongwen-writer: memory context failed: ${error.message}`);
    }
  }
  for (const factory of [draftTool, researchTool, factcheckTool, polishTool, memoryTool, browserTool, exportTool]) {
    try {
      const dispose = ctx.tools.register(factory(ctx));
      if (typeof dispose === "function") disposers.push(dispose);
    } catch (error) {
      ctx.logger?.error?.(`gongwen-writer: tool registration failed: ${error.message}`);
    }
  }
  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // ignore
      }
    }
  }, "gongwen-writer: cleanup");
  ctx.logger?.info?.("gongwen-writer: loaded");
}
