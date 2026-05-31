"use strict";

const { httpError } = require("./http-utils");

const GREEN_TARGETS = new Map([
  ["user_temp", {
    label: "用户临时目录",
    reason: "这是当前用户的临时文件目录，通常是安装器残留、解压临时件和应用运行时缓存。",
    hint: "可以直接清理；如果有程序正在写入，请先关闭正在运行的浏览器、安装器或编辑器。",
  }],
  ["local_temp", {
    label: "Local 临时目录",
    reason: "这是 Windows 常见的 Local 临时缓存目录，内容通常可再生。",
    hint: "建议优先清理这一项，收益高且通常不会影响个人文件。",
  }],
  ["crash_dumps", {
    label: "崩溃转储",
    reason: "这些文件是程序异常退出后留下的调试转储，通常不会再被普通用户用到。",
    hint: "如果近期不需要排查崩溃，可以直接删除。",
  }],
  ["inet_cache", {
    label: "系统网络缓存",
    reason: "这里主要是 Windows 网络缓存内容，删除后会自动重新生成。",
    hint: "清理前最好关闭浏览器和相关应用。",
  }],
  ["chrome_cache", {
    label: "Chrome 缓存",
    reason: "浏览器缓存可自动重建，是比较安全的可释放空间来源。",
    hint: "关闭 Chrome 后清理更稳妥，避免占用中的缓存文件删除失败。",
  }],
  ["edge_cache", {
    label: "Edge 缓存",
    reason: "浏览器缓存可自动重建，是比较安全的可释放空间来源。",
    hint: "关闭 Edge 后清理更稳妥，避免占用中的缓存文件删除失败。",
  }],
  ["vscode_cache", {
    label: "VS Code 缓存",
    reason: "这是编辑器运行时缓存，删除后会按需重新生成。",
    hint: "关闭 VS Code 后再清理，可以减少文件占用报错。",
  }],
]);

const YELLOW_TARGETS = new Map([
  ["downloads", {
    label: "下载目录",
    reason: "下载目录里通常混有安装包、压缩包、视频和文档，空间大但常包含用户仍在使用的文件。",
    hint: "先打开目录看最近不再需要的安装包、压缩包和大文件，再手动删除。",
  }],
  ["desktop", {
    label: "桌面",
    reason: "桌面文件往往是真实工作文件，不建议直接批量删除。",
    hint: "优先移动老旧大文件，或手动归档到其他磁盘。",
  }],
  ["documents", {
    label: "文档目录",
    reason: "这里通常是用户主动保存的内容，价值判断需要人工确认。",
    hint: "建议先按大小或修改时间筛查，再决定是否搬走或删除。",
  }],
  ["videos", {
    label: "视频目录",
    reason: "视频内容通常体积大，删除前需要确认是否为用户留存资料。",
    hint: "优先排查录屏、缓存视频和已备份的视频文件。",
  }],
]);

const RED_TARGETS = new Map([
  ["packages", {
    label: "Windows 应用数据",
    reason: "这里是 Microsoft Store 和部分系统应用的数据目录，里面既有缓存也可能有登录态、离线内容和业务数据。",
    hint: "不要直接整目录删除；如果它很大，先打开后只处理明确可识别的缓存子目录。",
  }],
  ["roaming_appdata", {
    label: "Roaming 应用数据",
    reason: "这里通常存放应用配置、历史记录和用户资料，误删容易影响软件正常使用。",
    hint: "更适合在具体应用内清理，或先定位到明确的缓存子目录再处理。",
  }],
]);

const PROFILE_YELLOW_NAMES = new Set([
  "desktop",
  "documents",
  "downloads",
  "music",
  "pictures",
  "videos",
]);

const PROFILE_RED_NAMES = new Set(["appdata"]);
const MIN_PROFILE_CHILD_BYTES = 256 * 1024 * 1024;

function createStorageAssistant(options) {
  const { registry, getAiConfig } = options;

  return {
    async analyzeAgent(agentId) {
      const scan = await registry.sendCommand(agentId, "storage_scan", {}, 240000);
      const base = buildDeterministicAnalysis(scan);
      const aiConfig = getAiConfig();
      let ai = null;
      let aiWarning = "";
      try {
        ai = await buildAiSummary(scan, base, aiConfig);
      } catch (error) {
        aiWarning = error && error.message ? String(error.message) : "storage AI request failed";
      }
      return mergeAnalysis(base, ai, scan, Boolean(aiConfig && aiConfig.apiKey), aiWarning, aiConfig);
    },
    async testConnection() {
      const aiConfig = getAiConfig();
      if (!aiConfig || !aiConfig.apiKey) {
        return {
          ok: false,
          detail: "API Key 未配置",
          config: publicAiConfig(aiConfig),
        };
      }
      try {
        const raw = await requestChatCompletion(aiConfig, [
          { role: "system", content: "你是连通性测试助手。请只回复 OK。" },
          { role: "user", content: "reply with OK" },
        ]);
        return {
          ok: true,
          detail: "模型请求成功",
          response_preview: String(raw || "").trim().slice(0, 200),
          config: publicAiConfig(aiConfig),
        };
      } catch (error) {
        return {
          ok: false,
          detail: error && error.message ? String(error.message) : "模型请求失败",
          config: publicAiConfig(aiConfig),
        };
      }
    },
  };
}

function buildDeterministicAnalysis(scan) {
  const items = [];
  const seen = new Set();
  const targetKeys = new Set();

  for (const target of Array.isArray(scan.targets) ? scan.targets : []) {
    if (!target || !target.exists || !target.path || typeof target.size !== "number" || target.size <= 0) continue;
    const normalized = normalizePath(target.path);
    seen.add(normalized);
    targetKeys.add(normalized);

    const green = GREEN_TARGETS.get(target.key);
    if (green) {
      items.push(makeItem("green", target, green));
      continue;
    }

    const yellow = YELLOW_TARGETS.get(target.key);
    if (yellow) {
      items.push(makeItem("yellow", target, yellow));
      continue;
    }

    const red = RED_TARGETS.get(target.key);
    if (red) {
      items.push(makeItem("red", target, red));
    }
  }

  for (const entry of Array.isArray(scan.profile_children) ? scan.profile_children : []) {
    if (!entry || !entry.path || typeof entry.size !== "number" || entry.size < MIN_PROFILE_CHILD_BYTES) continue;
    const normalized = normalizePath(entry.path);
    if (seen.has(normalized) || targetKeys.has(normalized)) continue;
    const name = String(entry.name || "").trim();
    if (!name) continue;
    const nameKey = name.toLowerCase();
    if (PROFILE_RED_NAMES.has(nameKey)) {
      items.push({
        tier: "red",
        label: "AppData 总目录",
        path: entry.path,
        name,
        size: entry.size,
        size_label: formatBytes(entry.size),
        reason: "这里混合了应用配置、缓存、数据库和离线内容，直接整目录删除风险很高。",
        hint: "建议先打开后再按具体应用逐层排查，不要直接删除这一层。",
        actions: [{ type: "open", label: "打开目录", path: entry.path }],
      });
      seen.add(normalized);
      continue;
    }
    if (PROFILE_YELLOW_NAMES.has(nameKey) || !name.startsWith(".")) {
      items.push({
        tier: "yellow",
        label: name,
        path: entry.path,
        name,
        size: entry.size,
        size_label: formatBytes(entry.size),
        reason: "这是用户目录下占用较大的内容，往往需要先人工确认是否仍在使用。",
        hint: "先打开目录查看大文件、旧安装包或历史归档，再决定是否删除或转移。",
        actions: [{ type: "open", label: "打开目录", path: entry.path }],
      });
      seen.add(normalized);
    }
  }

  items.sort((a, b) => b.size - a.size);

  const totals = {
    green: sumByTier(items, "green"),
    yellow: sumByTier(items, "yellow"),
    red: sumByTier(items, "red"),
  };
  const top = items.slice(0, 3);
  const riskItem = items.find((item) => item.tier === "red");

  return {
    summary: {
      overview: buildOverview(totals, top),
      priorities: top.length
        ? top.map((item) => `${item.label} ${item.size_label}，${priorityText(item.tier)}`)
        : ["当前没有识别到明显的大体积清理项。"],
      risk: riskItem
        ? `${riskItem.label} ${riskItem.size_label}，${riskItem.reason}`
        : "当前识别结果里没有必须回避的大型高风险目录，但仍建议先查看再删除。",
    },
    totals,
    items,
    inaccessible: Array.isArray(scan.inaccessible) ? scan.inaccessible : [],
    drives: Array.isArray(scan.drives) ? scan.drives : [],
  };
}

function makeItem(tier, target, definition) {
  const deleteAction = tier === "green" ? [{ type: "delete", label: "清理目录", path: target.path }, { type: "open", label: "打开目录", path: target.path }] : [{ type: "open", label: "打开目录", path: target.path }];
  return {
    tier,
    label: definition.label || target.label || target.name || baseName(target.path),
    path: target.path,
    name: target.name || baseName(target.path),
    size: target.size,
    size_label: formatBytes(target.size),
    reason: definition.reason,
    hint: definition.hint,
    actions: deleteAction,
  };
}

function buildOverview(totals, topItems) {
  const reclaimable = totals.green > 0 ? `可直接优先清理约 ${formatBytes(totals.green)}` : "当前没有识别到明确可直接清理的大块缓存";
  if (!topItems.length) return `${reclaimable}，建议先查看下载目录和 AppData 的实际内容。`;
  return `本次扫描里最值得先看的内容是 ${topItems[0].label}（${topItems[0].size_label}）；${reclaimable}。`;
}

function priorityText(tier) {
  if (tier === "green") return "适合直接清理";
  if (tier === "yellow") return "建议先人工确认";
  return "属于高风险目录，别直接整目录删";
}

async function buildAiSummary(scan, analysis, aiConfig) {
  if (!aiConfig || !aiConfig.apiKey) return null;

  const payload = {
    generated_at: scan.generated_at,
    drives: (analysis.drives || []).map((drive) => ({
      root: drive.root,
      total: drive.total,
      free: drive.free,
      kind: drive.kind,
    })),
    items: analysis.items.map((item) => ({
      tier: item.tier,
      label: item.label,
      path: item.path,
      size_bytes: item.size,
      reason: item.reason,
      hint: item.hint,
    })),
  };

  const prompt = [
    "你是 Windows 远程存储清理助手。",
    "请根据给定的扫描结果输出严格 JSON，不要使用 Markdown 代码块。",
    "约束：green 只描述纯缓存/临时文件；yellow 只描述需要人工确认的数据目录；red 只描述不建议直接手删的目录。",
    "输出格式：",
    '{"overview":"一句话总结","priorities":["最多三条优先建议"],"risk":"一句风险提示","notes":[{"path":"绝对路径","reason":"更具体的判断","hint":"更具体的处理建议"}]}',
  ].join("\n");

  const raw = await requestChatCompletion(aiConfig, [
    { role: "system", content: prompt },
    { role: "user", content: JSON.stringify(payload) },
  ]);
  const parsed = tryParseLooseJson(raw);
  if (!parsed || typeof parsed !== "object") return null;
  return {
    summary: {
      overview: typeof parsed.overview === "string" && parsed.overview.trim() ? parsed.overview.trim() : analysis.summary.overview,
      priorities: Array.isArray(parsed.priorities) ? parsed.priorities.map((value) => String(value).trim()).filter(Boolean).slice(0, 3) : analysis.summary.priorities,
      risk: typeof parsed.risk === "string" && parsed.risk.trim() ? parsed.risk.trim() : analysis.summary.risk,
    },
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
  };
}

function mergeAnalysis(base, ai, scan, aiEnabled, aiWarning, aiConfig) {
  const notesByPath = new Map();
  if (ai && Array.isArray(ai.notes)) {
    for (const note of ai.notes) {
      if (!note || !note.path) continue;
      notesByPath.set(normalizePath(note.path), {
        reason: typeof note.reason === "string" ? note.reason.trim() : "",
        hint: typeof note.hint === "string" ? note.hint.trim() : "",
      });
    }
  }

  return {
    generated_at: scan.generated_at,
    ai_enabled: aiEnabled,
    ai_warning: aiWarning || "",
    ai_config: publicAiConfig(aiConfig),
    drives: base.drives,
    totals: {
      green: { bytes: base.totals.green, label: formatBytes(base.totals.green) },
      yellow: { bytes: base.totals.yellow, label: formatBytes(base.totals.yellow) },
      red: { bytes: base.totals.red, label: formatBytes(base.totals.red) },
    },
    summary: ai ? ai.summary : base.summary,
    inaccessible: base.inaccessible,
    items: base.items.map((item) => {
      const note = notesByPath.get(normalizePath(item.path));
      return {
        ...item,
        reason: note && note.reason ? note.reason : item.reason,
        hint: note && note.hint ? note.hint : item.hint,
      };
    }),
  };
}

function publicAiConfig(aiConfig) {
  return {
    base_url: aiConfig && aiConfig.baseUrl ? aiConfig.baseUrl : "",
    model: aiConfig && aiConfig.model ? aiConfig.model : "",
    timeout_ms: aiConfig && aiConfig.timeoutMs ? aiConfig.timeoutMs : 0,
    has_api_key: Boolean(aiConfig && aiConfig.apiKey),
  };
}

async function requestChatCompletion(aiConfig, messages) {
  const endpoint = joinUrl(aiConfig.baseUrl, "/v1/chat/completions");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), aiConfig.timeoutMs || 45000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: aiConfig.model,
        temperature: 0.2,
        messages,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await safeResponseText(response);
      throw httpError(502, `storage AI request failed: ${detail || response.status}`);
    }
    const payload = await response.json();
    const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message ? payload.choices[0].message.content : "";
    return normalizeChatContent(content);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeChatContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item) return "";
      if (typeof item === "string") return item;
      if (typeof item.text === "string") return item.text;
      if (item.type === "text" && typeof item.content === "string") return item.content;
      return "";
    })
    .join("");
}

function tryParseLooseJson(text) {
  if (!text) return null;
  const cleaned = String(text).trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {}
  }
  return null;
}

function joinUrl(baseUrl, path) {
  return String(baseUrl || "").replace(/\/+$/, "") + path;
}

function normalizePath(path) {
  return String(path || "").trim().toLowerCase();
}

function baseName(path) {
  const normalized = String(path || "").replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function sumByTier(items, tier) {
  return items.filter((item) => item.tier === tier).reduce((sum, item) => sum + item.size, 0);
}

function formatBytes(value) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = Number(value || 0);
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index ? 1 : 0)} ${units[index]}`;
}

async function safeResponseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

module.exports = { createStorageAssistant };
