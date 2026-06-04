(function () {
  const state = { agents: [], selectedAgent: null, currentPath: null, history: [], historyIndex: -1 };
  let layer;

  const $ = (selector) => document.querySelector(selector);
  const agentsEl = $("#agents");
  const contentEl = $("#content");
  const pathInput = $("#pathInput");
  const statusBadge = $("#statusBadge");
  const deviceCountEl = $("#deviceCount");
  const folderTitleEl = $("#folderTitle");
  const folderMetaEl = $("#folderMeta");
  const currentAgentEl = $("#currentAgent");
  const backButton = $("#backButton");
  const forwardButton = $("#forwardButton");
  const upButton = $("#upButton");
  const refreshButton = $("#refreshButton");
  const openPathButton = $("#openPathButton");
  const newFileButton = $("#newFileButton");
  const openModelSettingsButton = $("#openModelSettingsButton");
  const openCleanupButton = $("#openCleanupButton");
  const openCommandButton = $("#openCommandButton");
  const refreshAgentsButton = $("#refreshAgentsButton");
  const logoutButton = $("#logoutButton");
  let cleanupLayerIndex = null;
  let modelSettingsLayerIndex = null;
  let cleanupProgressTimer = null;
  let cleanupProgressValue = 0;

  layui.use(["layer"], function () {
    layer = layui.layer;
    bindEvents();
    connectUiSocket();
    loadAgents();
  });

  function bindEvents() {
    upButton.onclick = () => {
      const parent = state.currentPath ? parentOf(state.currentPath) : null;
      if (parent) browse(state.selectedAgent, parent);
    };
    backButton.onclick = () => {
      if (state.historyIndex <= 0) return;
      state.historyIndex -= 1;
      browse(state.selectedAgent, state.history[state.historyIndex], { skipHistory: true });
    };
    forwardButton.onclick = () => {
      if (state.historyIndex >= state.history.length - 1) return;
      state.historyIndex += 1;
      browse(state.selectedAgent, state.history[state.historyIndex], { skipHistory: true });
    };
    refreshButton.onclick = () => {
      if (state.selectedAgent && state.currentPath) browse(state.selectedAgent, state.currentPath, { skipHistory: true });
    };
    openPathButton.onclick = openTypedPath;
    newFileButton.onclick = createFile;
    openModelSettingsButton.onclick = openModelSettingsDialog;
    openCleanupButton.onclick = openCleanupDialog;
    openCommandButton.onclick = openCommandDialog;
    refreshAgentsButton.onclick = loadAgents;
    pathInput.onkeydown = (event) => {
      if (event.key === "Enter") openTypedPath();
    };
    logoutButton.onclick = async () => {
      await fetch("/api/logout", { method: "POST" });
      location.reload();
    };
  }

  async function api(path, options) {
    const res = await fetch(path, options);
    if (res.status === 401) {
      location.reload();
      throw new Error("authentication required");
    }
    if (!res.ok) throw new Error((await res.json()).detail || "请求失败");
    return res;
  }

  async function loadAgents() {
    try {
      const res = await api("/api/agents");
      state.agents = await res.json();
      syncSelectedAgent();
      renderAgents();
    } catch (error) {
      if (error.message !== "authentication required") layer.msg(error.message || "加载设备失败", { icon: 2 });
    }
  }

  function connectUiSocket() {
    const ws = new WebSocket((location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/ws/ui");
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type !== "state") return;
      state.agents = message.agents;
      syncSelectedAgent();
      renderAgents();
    };
    ws.onclose = () => {
      statusBadge.textContent = "连接已断开";
      statusBadge.className = "layui-badge";
      setTimeout(connectUiSocket, 3000);
    };
  }

  function syncSelectedAgent() {
    if (state.selectedAgent && state.agents.some((agent) => agent.agent_id === state.selectedAgent)) return;
    state.selectedAgent = null;
    state.currentPath = null;
    state.history = [];
    state.historyIndex = -1;
    folderTitleEl.textContent = "文件管理器";
    folderMetaEl.textContent = state.agents.length ? "请选择一台设备" : "等待设备连接";
    currentAgentEl.textContent = "未选择设备";
    pathInput.value = "请选择设备";
    contentEl.innerHTML = emptyHtml("console", state.agents.length ? "请选择左侧设备或磁盘。" : "等待设备连接或选择左侧磁盘。");
    if (state.agents.length === 1) selectDevice(state.agents[0], false);
    updateNav();
  }

  function renderAgents() {
    statusBadge.textContent = state.agents.length ? `${state.agents.length} 台在线` : "未连接";
    statusBadge.className = `layui-badge ${state.agents.length ? "layui-bg-green" : "layui-bg-gray"}`;
    deviceCountEl.textContent = state.agents.length;
    agentsEl.innerHTML = "";
    if (!state.agents.length) {
      agentsEl.innerHTML = emptyHtml("notice", "暂无在线设备");
      return;
    }
    for (const agent of state.agents) {
      const row = document.createElement("div");
      row.className = "device-card" + (state.selectedAgent === agent.agent_id ? " active" : "");
      row.innerHTML = `
        <button class="device-main" type="button">
          <span class="device-icon"><i class="layui-icon layui-icon-engine"></i></span>
          <span class="device-text">
            <strong>${escapeHtml(agent.agent_id)}</strong>
            <small>${escapeHtml(agent.hostname || "unknown")} · ${agent.drives.length} 个磁盘</small>
          </span>
        </button>
        <button class="device-disconnect" type="button" title="关闭该设备端程序"><i class="layui-icon layui-icon-close"></i></button>
      `;
      row.querySelector(".device-main").onclick = () => selectDevice(agent, true);
      row.querySelector(".device-disconnect").onclick = () => shutdownAgent(agent.agent_id);
      agentsEl.appendChild(row);
      if (state.selectedAgent === agent.agent_id) renderDrives(agent);
    }
  }

  function selectDevice(agent, resetContent) {
    state.selectedAgent = agent.agent_id;
    if (resetContent) {
      state.currentPath = null;
      state.history = [];
      state.historyIndex = -1;
      contentEl.innerHTML = emptyHtml("file", agent.drives.length ? "请选择设备下方的磁盘。" : "该设备未检测到磁盘。");
    }
    folderTitleEl.textContent = agent.agent_id;
    folderMetaEl.textContent = agent.drives.length ? "请选择一个磁盘" : "未检测到磁盘";
    currentAgentEl.textContent = agent.hostname || agent.agent_id;
    updateNav();
    renderAgents();
  }

  function renderDrives(agent) {
    const wrap = document.createElement("div");
    wrap.className = "drive-list";
    for (const drive of agent.drives) {
      const button = document.createElement("button");
      button.className = "drive-item";
      button.type = "button";
      button.innerHTML = `
        <span><i class="layui-icon layui-icon-component"></i> ${escapeHtml(drive.root)}</span>
        <small>${escapeHtml(driveKind(drive))} · ${fmtSize(drive.free)} 可用</small>
      `;
      button.onclick = () => browse(agent.agent_id, drive.root);
      wrap.appendChild(button);
    }
    agentsEl.appendChild(wrap);
  }

  async function browse(agentId, path, options = {}) {
    state.selectedAgent = agentId;
    state.currentPath = path;
    if (!options.skipHistory) {
      state.history = state.history.slice(0, state.historyIndex + 1);
      if (state.history[state.history.length - 1] !== path) {
        state.history.push(path);
        state.historyIndex = state.history.length - 1;
      }
    }
    pathInput.value = path;
    folderTitleEl.textContent = baseName(path);
    folderMetaEl.textContent = "加载中...";
    contentEl.innerHTML = loadingHtml();
    updateNav();
    renderAgents();
    try {
      const res = await api(`/api/agents/${encodeURIComponent(agentId)}/list?path=${encodeURIComponent(path)}`);
      renderEntries(agentId, await res.json());
    } catch (error) {
      folderMetaEl.textContent = "读取失败";
      contentEl.innerHTML = emptyHtml("error", error.message || "读取失败");
    }
  }

  function renderEntries(agentId, data) {
    state.currentPath = data.path;
    pathInput.value = data.path;
    folderTitleEl.textContent = baseName(data.path);
    folderMetaEl.textContent = `${data.entries.length} 个项目`;
    if (!data.entries.length) {
      contentEl.innerHTML = emptyHtml("template", "目录为空");
      updateNav();
      return;
    }
    const rows = data.entries
      .map((entry) => {
        const isDir = entry.type === "dir";
        const encodedPath = encodeURIComponent(entry.path);
        const action = isDir
          ? `<button class="layui-btn layui-btn-primary layui-btn-xs" data-open="${encodedPath}">打开</button><button class="layui-btn layui-btn-danger layui-btn-xs" data-delete="${encodedPath}" data-name="${escapeHtml(entry.name)}" data-type="dir">删除</button>`
          : `<a class="layui-btn layui-btn-primary layui-btn-xs" href="/api/agents/${encodeURIComponent(agentId)}/download?path=${encodedPath}">下载</a><button class="layui-btn layui-btn-normal layui-btn-xs" data-edit="${encodedPath}">编辑</button><button class="layui-btn layui-btn-danger layui-btn-xs" data-delete="${encodedPath}" data-name="${escapeHtml(entry.name)}" data-type="file">删除</button>`;
        return `
          <tr data-path="${encodeURIComponent(entry.path)}" data-type="${entry.type}">
            <td><div class="file-name"><i class="layui-icon ${isDir ? "layui-icon-folder" : "layui-icon-file"}"></i><span>${escapeHtml(entry.name)}</span></div></td>
            <td>${isDir ? "文件夹" : "文件"}</td>
            <td>${fmtSize(entry.size)}</td>
            <td>${fmtTime(entry.modified)}</td>
            <td>${action}</td>
          </tr>
        `;
      })
      .join("");
    contentEl.innerHTML = `
      <div class="table-wrap">
        <table class="layui-table file-table">
          <thead><tr><th>名称</th><th>类型</th><th>大小</th><th>修改时间</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    contentEl.querySelectorAll("[data-open]").forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        browse(agentId, decodeURIComponent(button.dataset.open));
      };
    });
    contentEl.querySelectorAll("[data-edit]").forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        editFile(agentId, decodeURIComponent(button.dataset.edit));
      };
    });
    contentEl.querySelectorAll("[data-delete]").forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        deletePath(agentId, decodeURIComponent(button.dataset.delete), button.dataset.name || "", button.dataset.type);
      };
    });
    contentEl.querySelectorAll('tr[data-type="dir"]').forEach((row) => {
      row.ondblclick = () => browse(agentId, decodeURIComponent(row.dataset.path));
    });
    updateNav();
  }

  async function shutdownAgent(agentId) {
    layer.confirm(`关闭 ${escapeHtml(agentId)} 上的设备端？`, { title: "断开设备" }, async (index) => {
      layer.close(index);
      const loading = layer.load(2);
      try {
        await api(`/api/agents/${encodeURIComponent(agentId)}/shutdown`, { method: "POST" });
        layer.msg("已发送断开命令", { icon: 1 });
        if (state.selectedAgent === agentId) {
          state.selectedAgent = null;
          state.currentPath = null;
          contentEl.innerHTML = emptyHtml("ok", "设备已断开。");
        }
      } catch (error) {
        layer.msg(error.message || "断开失败", { icon: 2 });
      } finally {
        layer.close(loading);
      }
    });
  }

  async function editFile(agentId, path) {
    const loading = layer.load(2);
    try {
      const res = await api(`/api/agents/${encodeURIComponent(agentId)}/file?path=${encodeURIComponent(path)}`);
      const file = await res.json();
      layer.open({
        type: 1,
        title: `编辑 ${escapeHtml(file.name || baseName(path))}`,
        area: [editorWidth(), editorHeight()],
        content: `
          <div class="editor-dialog">
            <div class="editor-path">${escapeHtml(file.path || path)}</div>
            <textarea id="fileEditor" class="layui-textarea editor-textarea" spellcheck="false">${escapeHtml(file.content || "")}</textarea>
          </div>
        `,
        btn: ["保存", "取消"],
        yes: async (index) => {
          const textarea = document.querySelector("#fileEditor");
          const saveLoading = layer.load(2);
          try {
            await api(`/api/agents/${encodeURIComponent(agentId)}/file?path=${encodeURIComponent(path)}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: textarea.value }),
            });
            layer.close(index);
            layer.msg("保存成功", { icon: 1 });
            if (state.currentPath) browse(agentId, state.currentPath, { skipHistory: true });
          } catch (error) {
            layer.msg(error.message || "保存失败", { icon: 2 });
          } finally {
            layer.close(saveLoading);
          }
        },
      });
    } catch (error) {
      layer.msg(error.message || "读取文件失败", { icon: 2 });
    } finally {
      layer.close(loading);
    }
  }

  async function deletePath(agentId, path, name, type) {
    const typeLabel = type === "dir" ? "文件夹" : "文件";
    layer.confirm(`确定删除${typeLabel}「${escapeHtml(name || baseName(path))}」？${type === "dir" ? " 文件夹内所有内容都会被删除。" : ""}`, { title: "删除确认" }, async (index) => {
      layer.close(index);
      const loading = layer.load(2);
      try {
        await api(`/api/agents/${encodeURIComponent(agentId)}/file?path=${encodeURIComponent(path)}`, { method: "DELETE" });
        layer.msg("删除成功", { icon: 1 });
        if (state.currentPath) browse(agentId, state.currentPath, { skipHistory: true });
      } catch (error) {
        layer.msg(error.message || "删除失败", { icon: 2 });
      } finally {
        layer.close(loading);
      }
    });
  }

  function openTypedPath() {
    const nextPath = pathInput.value.trim();
    if (state.selectedAgent && nextPath) browse(state.selectedAgent, nextPath);
  }

  function createFile() {
    if (!state.selectedAgent || !state.currentPath) return;
    layer.open({
      type: 1,
      title: "新建文件",
      area: [editorWidth(), editorHeight()],
      content: `
        <div class="editor-dialog">
          <div class="layui-form-item">
            <label class="layui-form-label">文件名</label>
            <div class="layui-input-block">
              <input id="newFileName" class="layui-input" placeholder="例如 notes.txt">
            </div>
          </div>
          <div class="editor-path">${escapeHtml(state.currentPath)}</div>
          <textarea id="newFileContent" class="layui-textarea editor-textarea" spellcheck="false"></textarea>
        </div>
      `,
      btn: ["创建", "取消"],
      success: () => {
        const input = document.querySelector("#newFileName");
        if (input) input.focus();
      },
      yes: async (index) => {
        const nameInput = document.querySelector("#newFileName");
        const contentInput = document.querySelector("#newFileContent");
        const name = nameInput ? nameInput.value.trim() : "";
        const content = contentInput ? contentInput.value : "";
        if (!name) {
          layer.msg("请输入文件名", { icon: 2 });
          return;
        }
        const loading = layer.load(2);
        try {
          await api(`/api/agents/${encodeURIComponent(state.selectedAgent)}/file?path=${encodeURIComponent(state.currentPath)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, content }),
          });
          layer.close(index);
          layer.msg("创建成功", { icon: 1 });
          browse(state.selectedAgent, state.currentPath, { skipHistory: true });
        } catch (error) {
          layer.msg(error.message || "创建失败", { icon: 2 });
        } finally {
          layer.close(loading);
        }
      },
    });
  }

  function openCommandDialog() {
    if (!state.agents.length) {
      layer.msg("暂无在线设备", { icon: 2 });
      return;
    }
    const defaultAgent = state.selectedAgent || state.agents[0].agent_id;
    layer.open({
      type: 1,
      title: "命令执行",
      area: [editorWidth(), editorHeight()],
      content: `
        <div class="command-dialog">
          <label class="command-label">执行设备</label>
          <select id="commandAgent" class="command-select">${state.agents.map((agent) => `<option value="${escapeHtml(agent.agent_id)}"${agent.agent_id === defaultAgent ? " selected" : ""}>${escapeHtml(agent.agent_id)} · ${escapeHtml(agent.hostname || "unknown")}</option>`).join("")}</select>
          <label class="command-label">CMD 命令</label>
          <textarea id="commandInput" class="layui-textarea command-input" placeholder="例如 dir /a"></textarea>
          <div class="command-actions">
            <button id="runCommandButton" class="layui-btn layui-btn-sm">执行并等待结果</button>
          </div>
          <pre id="commandOutput" class="command-output">等待执行结果。</pre>
        </div>
      `,
      success: () => {
        const commandInput = document.querySelector("#commandInput");
        const runButton = document.querySelector("#runCommandButton");
        if (commandInput) commandInput.focus();
        if (runButton) runButton.onclick = runCommandFromDialog;
      },
    });
  }

  function openCleanupDialog() {
    if (!state.agents.length) {
      layer.msg("暂无在线设备", { icon: 2 });
      return;
    }
    const defaultAgent = state.selectedAgent || state.agents[0].agent_id;
    cleanupLayerIndex = layer.open({
      type: 1,
      title: "智能清理",
      area: [cleanupWidth(), cleanupHeight()],
      content: `
        <div class="cleanup-dialog">
          <div class="cleanup-toolbar">
            <div class="cleanup-field">
              <label class="command-label" for="cleanupAgent">分析设备</label>
              <select id="cleanupAgent" class="command-select">${state.agents.map((agent) => `<option value="${escapeHtml(agent.agent_id)}"${agent.agent_id === defaultAgent ? " selected" : ""}>${escapeHtml(agent.agent_id)} · ${escapeHtml(agent.hostname || "unknown")}</option>`).join("")}</select>
            </div>
            <div class="cleanup-toolbar-actions">
              <button id="runCleanupButton" class="layui-btn layui-btn-sm">开始分析</button>
            </div>
          </div>
          <div class="cleanup-note">只读扫描常见缓存、下载目录和用户目录，不会自动删除任何内容。</div>
          <div id="cleanupStatus" class="cleanup-status">选择设备后开始扫描，绿灯项可直接清理，黄红灯项建议先打开目录复查。</div>
          <div class="cleanup-progress" aria-hidden="true">
            <div class="cleanup-progress-bar">
              <span id="cleanupProgressFill"></span>
            </div>
            <div class="cleanup-progress-meta">
              <strong id="cleanupProgressLabel">等待开始</strong>
              <span id="cleanupProgressPercent">0%</span>
            </div>
          </div>
          <div id="cleanupResults" class="cleanup-results">
            ${emptyHtml("template", "等待开始分析。")}
          </div>
        </div>
      `,
      success: () => {
        const runButton = document.querySelector("#runCleanupButton");
        if (runButton) runButton.onclick = runCleanupAnalysisFromDialog;
        runCleanupAnalysisFromDialog();
      },
      end: () => {
        stopCleanupProgress();
        cleanupLayerIndex = null;
      },
    });
  }

  function openModelSettingsDialog() {
    modelSettingsLayerIndex = layer.open({
      type: 1,
      title: "模型配置",
      area: [settingsWidth(), settingsHeight()],
      content: `
        <div class="model-settings-dialog">
          <div class="cleanup-note">
            这里配置智能清理调用的大模型。当前实现按 OpenAI 兼容接口请求：<code>/v1/chat/completions</code>。
          </div>
          <div id="modelSettingsStatus" class="cleanup-status">正在读取当前配置...</div>
          <div class="layui-form-item">
            <label class="command-label" for="modelBaseUrl">请求地址</label>
            <input id="modelBaseUrl" class="layui-input" placeholder="https://lucen.run">
          </div>
          <div class="layui-form-item">
            <label class="command-label" for="modelId">Model ID</label>
            <input id="modelId" class="layui-input" placeholder="gpt-5.4">
          </div>
          <div class="layui-form-item">
            <label class="command-label" for="modelTimeout">超时毫秒</label>
            <input id="modelTimeout" class="layui-input" placeholder="45000">
          </div>
          <div class="layui-form-item">
            <label class="command-label" for="modelApiKey">API Key</label>
            <input id="modelApiKey" class="layui-input" type="password" placeholder="留空表示清空">
            <div id="modelApiKeyHint" class="settings-hint"></div>
          </div>
          <div class="settings-actions">
            <button id="saveModelSettingsButton" class="layui-btn layui-btn-sm">保存配置</button>
            <button id="testModelSettingsButton" class="layui-btn layui-btn-warm layui-btn-sm">测试连接</button>
            <button id="reloadModelSettingsButton" class="layui-btn layui-btn-primary layui-btn-sm">重新读取</button>
          </div>
          <pre id="modelTestOutput" class="command-output settings-output">等待测试结果。</pre>
        </div>
      `,
      success: () => {
        const saveButton = document.querySelector("#saveModelSettingsButton");
        const testButton = document.querySelector("#testModelSettingsButton");
        const reloadButton = document.querySelector("#reloadModelSettingsButton");
        if (saveButton) saveButton.onclick = saveModelSettings;
        if (testButton) testButton.onclick = testModelSettings;
        if (reloadButton) reloadButton.onclick = loadModelSettings;
        loadModelSettings();
      },
      end: () => {
        modelSettingsLayerIndex = null;
      },
    });
  }

  async function loadModelSettings() {
    const statusEl = document.querySelector("#modelSettingsStatus");
    const baseUrlEl = document.querySelector("#modelBaseUrl");
    const modelEl = document.querySelector("#modelId");
    const timeoutEl = document.querySelector("#modelTimeout");
    const apiKeyEl = document.querySelector("#modelApiKey");
    const apiKeyHintEl = document.querySelector("#modelApiKeyHint");
    if (!statusEl || !baseUrlEl || !modelEl || !timeoutEl || !apiKeyEl || !apiKeyHintEl) return;

    statusEl.textContent = "正在读取当前配置...";
    try {
      const res = await api("/api/settings/storage-ai");
      const settings = await res.json();
      baseUrlEl.value = settings.base_url || "";
      modelEl.value = settings.model || "";
      timeoutEl.value = settings.timeout_ms || 45000;
      apiKeyEl.value = "";
      apiKeyHintEl.textContent = settings.has_api_key ? `当前已配置 Key：${settings.api_key_masked || "已隐藏"}` : "当前未配置 API Key。";
      statusEl.textContent = "配置已载入。";
    } catch (error) {
      statusEl.textContent = error.message || "读取配置失败";
      layer.msg(error.message || "读取配置失败", { icon: 2 });
    }
  }

  async function saveModelSettings() {
    const statusEl = document.querySelector("#modelSettingsStatus");
    const baseUrlEl = document.querySelector("#modelBaseUrl");
    const modelEl = document.querySelector("#modelId");
    const timeoutEl = document.querySelector("#modelTimeout");
    const apiKeyEl = document.querySelector("#modelApiKey");
    const apiKeyHintEl = document.querySelector("#modelApiKeyHint");
    const saveButton = document.querySelector("#saveModelSettingsButton");
    if (!statusEl || !baseUrlEl || !modelEl || !timeoutEl || !apiKeyEl || !apiKeyHintEl || !saveButton) return;

    const baseUrl = baseUrlEl.value.trim();
    const model = modelEl.value.trim();
    const timeoutMs = Number(timeoutEl.value);
    const apiKey = apiKeyEl.value.trim();
    if (!baseUrl) {
      layer.msg("请输入请求地址", { icon: 2 });
      baseUrlEl.focus();
      return;
    }
    if (!model) {
      layer.msg("请输入 Model ID", { icon: 2 });
      modelEl.focus();
      return;
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      layer.msg("请输入有效的超时毫秒", { icon: 2 });
      timeoutEl.focus();
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "保存中...";
    statusEl.textContent = "正在保存模型配置...";
    try {
      const res = await api("/api/settings/storage-ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: baseUrl,
          model,
          timeout_ms: timeoutMs,
          api_key: apiKey,
        }),
      });
      const settings = await res.json();
      apiKeyEl.value = "";
      apiKeyHintEl.textContent = settings.has_api_key ? `当前已配置 Key：${settings.api_key_masked || "已隐藏"}` : "当前未配置 API Key。";
      statusEl.textContent = "配置已保存。";
      layer.msg("模型配置已保存", { icon: 1 });
    } catch (error) {
      statusEl.textContent = error.message || "保存失败";
      layer.msg(error.message || "保存失败", { icon: 2 });
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "保存配置";
    }
  }

  async function testModelSettings() {
    const outputEl = document.querySelector("#modelTestOutput");
    const statusEl = document.querySelector("#modelSettingsStatus");
    const testButton = document.querySelector("#testModelSettingsButton");
    if (!outputEl || !statusEl || !testButton) return;

    testButton.disabled = true;
    testButton.textContent = "测试中...";
    statusEl.textContent = "正在请求模型，请稍候...";
    outputEl.textContent = "发送测试请求中...";
    try {
      const res = await api("/api/settings/storage-ai/test", { method: "POST" });
      const result = await res.json();
      statusEl.textContent = result.ok ? "模型连接测试成功。" : "模型连接测试失败。";
      outputEl.textContent = [
        `状态: ${result.ok ? "成功" : "失败"}`,
        `地址: ${result.config && result.config.base_url ? result.config.base_url : "(未配置)"}`,
        `模型: ${result.config && result.config.model ? result.config.model : "(未配置)"}`,
        `超时: ${result.config && result.config.timeout_ms ? result.config.timeout_ms : 0} ms`,
        `API Key: ${result.config && result.config.has_api_key ? "已配置" : "未配置"}`,
        "",
        result.detail || "",
        result.response_preview ? `\n返回预览:\n${result.response_preview}` : "",
      ].join("\n");
      layer.msg(result.ok ? "模型连接成功" : "模型连接失败", { icon: result.ok ? 1 : 2 });
    } catch (error) {
      statusEl.textContent = error.message || "模型测试失败";
      outputEl.textContent = error.message || "模型测试失败";
      layer.msg(error.message || "模型测试失败", { icon: 2 });
    } finally {
      testButton.disabled = false;
      testButton.textContent = "测试连接";
    }
  }

  async function runCleanupAnalysisFromDialog() {
    const agentSelect = document.querySelector("#cleanupAgent");
    const runButton = document.querySelector("#runCleanupButton");
    const statusEl = document.querySelector("#cleanupStatus");
    const resultsEl = document.querySelector("#cleanupResults");
    const agentId = agentSelect ? agentSelect.value : "";
    if (!agentId || !runButton || !statusEl || !resultsEl) return;

    runButton.disabled = true;
    runButton.textContent = "分析中...";
    statusEl.textContent = "正在读取设备上的常见缓存和大目录，请稍候...";
    resultsEl.innerHTML = loadingHtml();
    startCleanupProgress();
    try {
      const res = await api(`/api/agents/${encodeURIComponent(agentId)}/storage-analysis`, { method: "POST" });
      const result = await res.json();
      finishCleanupProgress("分析完成");
      renderCleanupAnalysis(agentId, result);
    } catch (error) {
      const detail = formatCleanupError(error);
      failCleanupProgress("分析失败");
      statusEl.textContent = detail;
      resultsEl.innerHTML = emptyHtml("error", detail);
      layer.msg(detail, { icon: 2 });
    } finally {
      runButton.disabled = false;
      runButton.textContent = "开始分析";
    }
  }

  function renderCleanupAnalysis(agentId, result) {
    const statusEl = document.querySelector("#cleanupStatus");
    const resultsEl = document.querySelector("#cleanupResults");
    if (!statusEl || !resultsEl) return;

    const drives = Array.isArray(result.drives) ? result.drives : [];
    const items = Array.isArray(result.items) ? result.items : [];
    const greenItems = items.filter((item) => item.tier === "green");
    const yellowItems = items.filter((item) => item.tier === "yellow");
    const redItems = items.filter((item) => item.tier === "red");
    const priorities = Array.isArray(result.summary && result.summary.priorities) ? result.summary.priorities : [];
    const inaccessible = Array.isArray(result.inaccessible) ? result.inaccessible : [];
    const aiConfig = result.ai_config || {};
    const configLine = aiConfig.base_url && aiConfig.model ? `当前模型：${aiConfig.model} @ ${aiConfig.base_url}` : "";
    const aiLine = result.ai_enabled ? (result.ai_warning ? `模型总结未生成：${result.ai_warning}` : "模型总结已启用。") : "模型未配置，当前展示本地规则分析结果。";
    statusEl.textContent = `${aiLine}${configLine ? ` ${configLine}。` : ""}${result.generated_at ? ` 扫描时间：${fmtTime(result.generated_at)}。` : ""}`;

    resultsEl.innerHTML = `
      <div class="cleanup-summary-pills">
        <div class="cleanup-pill cleanup-pill-green">可直接清理 ${escapeHtml(result.totals && result.totals.green ? result.totals.green.label : "0 B")}</div>
        <div class="cleanup-pill cleanup-pill-yellow">需人工确认 ${escapeHtml(result.totals && result.totals.yellow ? result.totals.yellow.label : "0 B")}</div>
        <div class="cleanup-pill cleanup-pill-red">高风险目录 ${escapeHtml(result.totals && result.totals.red ? result.totals.red.label : "0 B")}</div>
      </div>
      <div class="cleanup-overview">
        <strong>执行建议</strong>
        <p>${escapeHtml(result.summary && result.summary.overview ? result.summary.overview : "未生成摘要。")}</p>
      </div>
      <div class="cleanup-priority-box">
        <strong>优先顺序</strong>
        <ul>${priorities.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>当前没有明显的大体积清理项。</li>"}</ul>
      </div>
      <div class="cleanup-risk-box">
        <strong>风险提示</strong>
        <p>${escapeHtml(result.summary && result.summary.risk ? result.summary.risk : "删除前请先确认目录内容。")}</p>
      </div>
      ${drives.length ? `<div class="cleanup-drive-grid">${drives.map(renderDriveCard).join("")}</div>` : ""}
      ${renderCleanupSection("绿灯：适合直接清理", greenItems, "pure", "没有识别到可直接清理的大缓存。")}
      ${renderCleanupSection("黄灯：先人工确认", yellowItems, "review", "没有识别到需要重点复核的用户目录。")}
      ${renderCleanupSection("红灯：不要直接整目录删", redItems, "risk", "当前没有额外的高风险目录提示。")}
      ${inaccessible.length ? `<div class="cleanup-footnote">有 ${inaccessible.length} 个目录无法完整读取，通常是权限不足或文件被占用导致。</div>` : ""}
    `;

    resultsEl.querySelectorAll("[data-clean-open]").forEach((button) => {
      button.onclick = () => {
        if (cleanupLayerIndex !== null) layer.close(cleanupLayerIndex);
        browse(agentId, decodeURIComponent(button.dataset.cleanOpen));
      };
    });
    resultsEl.querySelectorAll("[data-clean-delete]").forEach((button) => {
      button.onclick = () => deleteCleanupPath(agentId, decodeURIComponent(button.dataset.cleanDelete), button.dataset.label || "");
    });
  }

  function renderCleanupSection(title, items, tone, emptyText) {
    return `
      <section class="cleanup-section">
        <div class="cleanup-section-head">
          <h3>${escapeHtml(title)}</h3>
          <span>${items.length} 项</span>
        </div>
        ${items.length ? `<div class="cleanup-card-grid">${items.map((item) => renderCleanupItem(item, tone)).join("")}</div>` : `<div class="cleanup-empty">${escapeHtml(emptyText)}</div>`}
      </section>
    `;
  }

  function renderCleanupItem(item, tone) {
    return `
      <article class="cleanup-card cleanup-card-${tone}">
        <div class="cleanup-card-top">
          <div>
            <h4>${escapeHtml(item.label || baseName(item.path || ""))}</h4>
            <div class="cleanup-card-path">${escapeHtml(item.path || "")}</div>
          </div>
          <strong>${escapeHtml(item.size_label || fmtSize(item.size))}</strong>
        </div>
        <p>${escapeHtml(item.reason || "")}</p>
        <div class="cleanup-card-hint">${escapeHtml(item.hint || "")}</div>
        <div class="cleanup-card-actions">
          ${(Array.isArray(item.actions) ? item.actions : []).map((action) => action.type === "delete"
            ? `<button class="layui-btn layui-btn-danger layui-btn-sm" data-clean-delete="${encodeURIComponent(action.path)}" data-label="${escapeHtml(item.label || "")}">${escapeHtml(action.label)}</button>`
            : `<button class="layui-btn layui-btn-primary layui-btn-sm" data-clean-open="${encodeURIComponent(action.path)}">${escapeHtml(action.label)}</button>`).join("")}
        </div>
      </article>
    `;
  }

  function renderDriveCard(drive) {
    const total = Number(drive.total || 0);
    const free = Number(drive.free || 0);
    const used = total > 0 ? Math.max(total - free, 0) : 0;
    const percent = total > 0 ? Math.min((used / total) * 100, 100) : 0;
    return `
      <div class="cleanup-drive-card">
        <div class="cleanup-drive-top">
          <strong>${escapeHtml(drive.root || "磁盘")}</strong>
          <span>${escapeHtml(drive.kind || "")}</span>
        </div>
        <div class="cleanup-drive-bar"><span style="width:${percent.toFixed(1)}%"></span></div>
        <div class="cleanup-drive-meta">${fmtSize(used)} 已用 / ${fmtSize(free)} 可用</div>
      </div>
    `;
  }

  async function deleteCleanupPath(agentId, path, label) {
    layer.confirm(`确定清理「${escapeHtml(label || baseName(path))}」？这会删除该目录下当前扫描命中的缓存内容。`, { title: "清理确认" }, async (index) => {
      layer.close(index);
      const loading = layer.load(2);
      try {
        await api(`/api/agents/${encodeURIComponent(agentId)}/file?path=${encodeURIComponent(path)}`, { method: "DELETE" });
        layer.msg("清理成功", { icon: 1 });
        if (state.selectedAgent === agentId && state.currentPath) browse(agentId, state.currentPath, { skipHistory: true });
        await runCleanupAnalysisFromDialog();
      } catch (error) {
        layer.msg(error.message || "清理失败", { icon: 2 });
      } finally {
        layer.close(loading);
      }
    });
  }

  async function runCommandFromDialog() {
    const agentSelect = document.querySelector("#commandAgent");
    const commandInput = document.querySelector("#commandInput");
    const commandOutput = document.querySelector("#commandOutput");
    const runButton = document.querySelector("#runCommandButton");
    const agentId = agentSelect ? agentSelect.value : "";
    const command = commandInput ? commandInput.value.trim() : "";
    if (!agentId) {
      layer.msg("请选择设备", { icon: 2 });
      return;
    }
    if (!command) {
      layer.msg("请输入命令", { icon: 2 });
      return;
    }
    runButton.disabled = true;
    runButton.textContent = "执行中...";
    commandOutput.textContent = "命令已发送，等待结果...";
    try {
      const res = await api(`/api/agents/${encodeURIComponent(agentId)}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const result = await res.json();
      const stdout = result.stdout ? result.stdout.trimEnd() : "";
      const stderr = result.stderr ? result.stderr.trimEnd() : "";
      commandOutput.textContent = [
        `设备: ${agentId}`,
        `命令: ${result.command || command}`,
        `退出码: ${result.exit_code}`,
        "",
        stdout || "(无标准输出)",
        stderr ? "\n[stderr]\n" + stderr : "",
      ].join("\n");
    } catch (error) {
      commandOutput.textContent = error.message || "执行失败";
      layer.msg(error.message || "执行失败", { icon: 2 });
    } finally {
      runButton.disabled = false;
      runButton.textContent = "执行并等待结果";
    }
  }

  function updateNav() {
    const hasPath = Boolean(state.currentPath && state.selectedAgent);
    const parent = hasPath ? parentOf(state.currentPath) : null;
    backButton.disabled = state.historyIndex <= 0;
    forwardButton.disabled = state.historyIndex >= state.history.length - 1;
    upButton.disabled = !parent;
    refreshButton.disabled = !hasPath;
    openPathButton.disabled = !state.selectedAgent;
    newFileButton.disabled = !hasPath;
    pathInput.disabled = !state.selectedAgent;
  }

  function emptyHtml(icon, text) {
    return `<div class="empty-state"><i class="layui-icon layui-icon-${icon}"></i><p>${escapeHtml(text)}</p></div>`;
  }

  function loadingHtml() {
    return `<div class="empty-state"><i class="layui-icon layui-icon-loading layui-anim layui-anim-rotate layui-anim-loop"></i><p>加载中...</p></div>`;
  }

  function startCleanupProgress() {
    stopCleanupProgress();
    cleanupProgressValue = 6;
    renderCleanupProgress("正在连接设备", cleanupProgressValue);
    const stages = [
      { limit: 22, step: 4, label: "正在连接设备" },
      { limit: 46, step: 3, label: "正在扫描缓存目录" },
      { limit: 72, step: 2, label: "正在统计文件大小" },
      { limit: 88, step: 1, label: "正在整理分析结果" },
      { limit: 94, step: 1, label: "正在生成最终摘要" },
    ];
    cleanupProgressTimer = setInterval(() => {
      for (const stage of stages) {
        if (cleanupProgressValue < stage.limit) {
          cleanupProgressValue = Math.min(stage.limit, cleanupProgressValue + stage.step);
          renderCleanupProgress(stage.label, cleanupProgressValue);
          return;
        }
      }
      renderCleanupProgress("正在等待设备返回结果", cleanupProgressValue);
    }, 1100);
  }

  function finishCleanupProgress(label) {
    stopCleanupProgress();
    renderCleanupProgress(label || "分析完成", 100);
  }

  function failCleanupProgress(label) {
    stopCleanupProgress();
    renderCleanupProgress(label || "分析失败", cleanupProgressValue ? Math.min(cleanupProgressValue, 96) : 0);
  }

  function stopCleanupProgress() {
    if (cleanupProgressTimer) {
      clearInterval(cleanupProgressTimer);
      cleanupProgressTimer = null;
    }
  }

  function renderCleanupProgress(label, percent) {
    const fillEl = document.querySelector("#cleanupProgressFill");
    const percentEl = document.querySelector("#cleanupProgressPercent");
    const labelEl = document.querySelector("#cleanupProgressLabel");
    if (fillEl) fillEl.style.width = `${Math.max(0, Math.min(percent, 100))}%`;
    if (percentEl) percentEl.textContent = `${Math.round(Math.max(0, Math.min(percent, 100)))}%`;
    if (labelEl) labelEl.textContent = label || "处理中";
  }

  function formatCleanupError(error) {
    const message = error && error.message ? String(error.message).trim() : "";
    if (!message) return "分析失败";
    if (message === "Unexpected end of JSON input") {
      return "分析请求被中断，设备可能在扫描过程中断线或浏览器提前取消了请求。";
    }
    if (message.includes("Unexpected token '<'")) {
      return "分析接口返回了网页内容，通常是反向代理超时或服务异常。";
    }
    return message;
  }

  function fmtSize(size) {
    if (size === null || size === undefined) return "";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = Number(size);
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function fmtTime(value) {
    if (!value) return "";
    const date = new Date(Number(value) * 1000);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function rootOf(path) {
    const match = String(path || "").match(/^[A-Z]:\\/i);
    return match ? match[0] : "";
  }

  function parentOf(path) {
    const root = rootOf(path);
    const normalized = String(path || "").replace(/\\+$/, "");
    if (!root || normalized.length <= root.length) return null;
    const index = normalized.lastIndexOf("\\");
    return index >= root.length ? normalized.slice(0, index + 1) : root;
  }

  function baseName(path) {
    const root = rootOf(path);
    const normalized = String(path || "").replace(/\\+$/, "");
    if (!normalized) return "文件管理器";
    if (root && normalized.length <= root.length) return root;
    const index = normalized.lastIndexOf("\\");
    return index >= 0 ? normalized.slice(index + 1) : normalized;
  }

  function driveKind(drive) {
    const map = { removable: "可移动", fixed: "本地", network: "网络", cdrom: "光驱" };
    return map[drive.kind] || "磁盘";
  }

  function editorWidth() {
    return window.innerWidth < 760 ? "94vw" : "760px";
  }

  function editorHeight() {
    return window.innerHeight < 700 ? "82vh" : "620px";
  }

  function cleanupWidth() {
    return window.innerWidth < 980 ? "96vw" : "980px";
  }

  function cleanupHeight() {
    return window.innerHeight < 760 ? "88vh" : "720px";
  }

  function settingsWidth() {
    return window.innerWidth < 700 ? "94vw" : "680px";
  }

  function settingsHeight() {
    return window.innerHeight < 680 ? "80vh" : "560px";
  }
})();
