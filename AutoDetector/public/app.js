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
  const openCommandButton = $("#openCommandButton");
  const refreshAgentsButton = $("#refreshAgentsButton");
  const logoutButton = $("#logoutButton");

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
})();
