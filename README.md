# AutoDetector

AutoDetector 是一个 Windows 设备静默检测与远程文件管理工具。它由一个 Web Server 和多个 Windows Agent 组成：

- Server 运行在管理端，提供网页登录后台、Agent 连接管理和文件操作 API。
- Agent 运行在被管理的 Windows 机器上，连接 Server 后上报磁盘信息，并执行浏览、下载、新建、编辑、删除、关闭自身等命令。

项目适合内网、实验室、机房、受控办公环境里的 Windows 设备文件管理。不要直接暴露到公网。

## 功能

- 密码登录的 Web 后台。
- 实时显示在线 Agent、主机名和磁盘列表。
- 浏览本地盘、可移动盘、网络盘和光驱。
- 下载文件，支持中文文件名。
- 在线新建 UTF-8 文本文件。
- 在线编辑 UTF-8 文本文件。
- 在线删除文件或文件夹，Agent 会拒绝删除盘符根目录。
- 后台主动断开指定 Agent，也就是关闭目标机器上的 `AutoDetectorAgent.exe`。
- 后台远程执行基础 `cmd.exe /c` 命令，弹窗中默认选中当前设备，也可切换其他在线设备。
- 后台内置 `storage-analyzer` 风格的“智能清理”面板：远程扫描 Windows 常见缓存、下载目录和用户目录，按绿/黄/红三级给出建议，并可直接清理绿灯项。
- 后台支持前端显式配置智能清理使用的大模型，请求地址、Model ID、超时和 API Key 都可在网页里修改。
- Agent 无控制台窗口、无任务栏窗口、无托盘图标。
- Agent 断线自动重连，Server 通过心跳识别离线。
- layui 响应式后台页面，支持桌面和移动端浏览器。
- 可选长期启动：Agent 首次运行后复制到本机用户目录，并创建当前用户开机启动快捷方式。

## 目录结构

```text
AutoDetector
├─ server.js              # Server 入口
├─ src/                   # 后端模块
│  ├─ app.js
│  ├─ routes.js
│  ├─ agent-registry.js
│  ├─ session-store.js
│  ├─ simple-websocket.js
│  ├─ ws-handlers.js
│  ├─ config.js
│  ├─ storage-assistant.js
│  ├─ storage-ai-settings.js
│  └─ http-utils.js
├─ public/                # Web 后台页面
│  ├─ index.html
│  ├─ login.html
│  ├─ app.js
│  ├─ login.js
│  └─ styles.css
├─ build-agent.ps1        # Windows Agent 生成脚本
└─ storage-ai.settings.json  # 前端保存的模型配置文件，可选
```

Server 后端只使用 Node.js 内置模块，不需要 `npm install`。Web 页面通过 CDN 加载 layui，浏览器需要能访问 layui CDN。

## 环境要求

Server 端：

- Node.js
- 能被 Agent 机器访问的 IP 和端口

Agent 生成端：

- Windows
- .NET Framework 4.x 自带的 C# 编译器 `csc.exe`

Agent 运行端：

- Windows
- 只需要生成后的 `AutoDetectorAgent.exe`

## 启动 Server

在项目根目录运行：

```powershell
node server.js --host 0.0.0.0 --port 8000
```

浏览器打开：

```text
http://SERVER_IP:8000
```

默认后台密码：

```text
12345678
```

建议实际使用时修改密码：

```powershell
node server.js --host 0.0.0.0 --port 8000 --password "your-password"
```

也可以用环境变量：

```powershell
$env:AUTODETECTOR_PASSWORD = "your-password"
node server.js --host 0.0.0.0 --port 8000
```

其他参数：

```powershell
node server.js `
  --host 0.0.0.0 `
  --port 8000 `
  --agent-timeout-ms 15000 `
  --storage-ai-base-url https://lucen.run `
  --storage-ai-model gpt-5.4 `
  --storage-ai-api-key "your-api-key"
```

`--agent-timeout-ms` 表示多久没有收到 Agent 心跳后判定离线，默认 15000 毫秒。

智能清理模型参数：

- `--storage-ai-base-url`：模型服务地址，默认 `https://lucen.run`
- `--storage-ai-model`：模型 ID，默认 `gpt-5.4`
- `--storage-ai-api-key`：模型 API Key，未配置时仍可用本地规则分析，但不会生成 AI 总结
- `--storage-ai-timeout-ms`：模型请求超时，默认 45000 毫秒

也支持环境变量：

```powershell
$env:AUTODETECTOR_STORAGE_AI_BASE_URL = "https://lucen.run"
$env:AUTODETECTOR_STORAGE_AI_MODEL = "gpt-5.4"
$env:AUTODETECTOR_STORAGE_AI_API_KEY = "your-api-key"
node server.js --host 0.0.0.0 --port 8000
```

如果希望把前端保存的模型配置文件放到别的位置，也可以指定：

```powershell
node server.js `
  --storage-ai-config-path "C:\AutoDetector\storage-ai.settings.json"
```

## 生成 Agent

在 Windows 上运行：

```powershell
.\build-agent.ps1
```

按提示填写：

- `Server WebSocket`：Agent 要连接的 Server 地址，例如 `ws://SERVER_IP:8000/ws/agent`
- `Output directory`：输出目录，默认 `dist\agent`
- `长期启动`：是否让生成的 Agent 首次运行后安装到本机并设置当前用户开机启动

默认输出：

```text
dist\agent\AutoDetectorAgent.exe
```

也可以直接用参数生成：

```powershell
.\build-agent.ps1 `
  -Server ws://SERVER_IP:8000/ws/agent `
  -OutputDir .\dist\agent `
  -LongTermStartup 否 `
  -ScanIntervalSeconds 2 `
  -ReconnectSeconds 5 `
  -MaxDownloadBytes 268435456
```

参数说明：

- `-Server`：Server WebSocket 地址。
- `-OutputDir`：生成 EXE 的输出目录。
- `-LongTermStartup`：`是` 或 `否`。也支持 `yes/no`、`true/false`、`1/0`。
- `-ScanIntervalSeconds`：Agent 扫描磁盘变化的间隔，默认 2 秒。
- `-ReconnectSeconds`：断线后重连间隔，默认 5 秒。
- `-MaxDownloadBytes`：单文件读取上限，默认 268435456 字节，也就是 256 MB。

## 运行 Agent

把生成的 `AutoDetectorAgent.exe` 放到目标 Windows 机器上双击运行即可。

运行效果：

- 不显示控制台窗口。
- 不显示任务栏窗口。
- 不显示系统托盘图标。
- 成功连接后，会出现在 Web 后台左侧设备列表。

如果生成时 `长期启动` 选择 `否`，Agent 只在本次运行期间生效。结束进程或重启电脑后不会自动运行。

如果生成时 `长期启动` 选择 `是`，Agent 首次运行会：

1. 复制自身到：

   ```text
   %LOCALAPPDATA%\AutoDetector\AutoDetectorAgent.exe
   ```

2. 在当前用户的启动文件夹创建快捷方式：

   ```text
   shell:startup\AutoDetectorAgent.lnk
   ```

3. 启动本机目录中的副本，然后退出原始位置的进程。

这样下次当前用户登录 Windows 后，Agent 会自动启动。

## 使用 Web 后台

1. 启动 Server。
2. 打开 `http://SERVER_IP:8000`。
3. 输入后台密码登录。
4. 在目标机器运行 `AutoDetectorAgent.exe`。
5. 后台左侧选择在线设备。
6. 点击设备下方的盘符进入文件管理。

文件管理支持：

- 后退、前进、上一级、刷新。
- 输入路径后点击 `打开`。
- `新建文件`：在当前目录创建 UTF-8 文本文件。
- `下载`：下载文件。
- `编辑`：在线编辑 UTF-8 文本文件并保存。
- `删除`：删除文件或文件夹。删除文件夹会递归删除其中内容。
- `断开设备`：关闭目标机器上的 Agent 进程。
- `命令执行`：点击顶部按钮后弹窗选择在线设备、输入命令、等待执行结果；返回 `stdout`、`stderr` 和退出码。
- `智能清理`：点击顶部按钮后对目标设备执行只读扫描，生成缓存/下载/应用数据三级建议。绿灯项可直接清理，黄红灯项建议先打开目录人工确认。
- `模型配置`：点击顶部按钮后可直接在网页里查看和修改智能清理的大模型请求地址、Model ID、超时和 API Key。保存后会写入 `storage-ai.settings.json`，下次启动仍会生效。
- `测试连接`：在“模型配置”窗口内可直接向当前配置的模型发一条最小测试请求，用来确认地址、模型名和 API Key 是否真的可用。

## 智能清理说明

- 新版 Agent 新增了 `storage_scan` 命令，所以要先重新运行 `.\build-agent.ps1` 生成新的 `AutoDetectorAgent.exe`，再部署到目标机器。
- 智能清理只扫描用户态常见目录，例如 `Temp`、浏览器缓存、`Downloads`、`Desktop`、`Documents`、`Videos`、`AppData` 等。
- 扫描阶段全程只读，不会自动删除。
- 绿灯项默认是可再生缓存或临时文件，前端会给出“清理目录”按钮。
- 黄灯项和红灯项只给“打开目录”按钮，避免误删用户数据或应用数据。
- 如果模型接口不可用，页面仍会展示本地规则分析结果，只是不会有 AI 总结。
- 当前代码按 OpenAI 兼容方式请求模型：`POST {baseUrl}/v1/chat/completions`，所以如果 `lucen.run` 不是这套兼容格式，就需要把 `src/storage-assistant.js` 里的请求格式改成它实际要求的协议。
- 如果后台出现 `agent timed out`，先确认你已经重新生成并部署了新版 Agent。旧版 Agent 在执行大目录扫描时会阻塞心跳；新版已经改成命令后台执行，扫描过程中仍会继续发 `ping`。
- 如果设备本身很慢、网络抖动明显，也可以把服务端的 `--agent-timeout-ms` 从默认 `15000` 提高到 `60000` 再观察。

## 排障速查

- `agent timed out`：优先确认目标机器运行的是新版 `AutoDetectorAgent.exe`，然后查看 `%APPDATA%\AutoDetector\tray-agent.log`。如果网络抖动或设备较慢，再把服务端 `--agent-timeout-ms` 提高到 `60000`。
- 模型测试失败：先在后台“模型配置”里点一次“测试连接”。如果失败，优先排查 4 项：`请求地址` 是否正确、`Model ID` 是否可用、`API Key` 是否有效、该中转站是否真的兼容 `POST /v1/chat/completions`。
- 无法覆盖生成 Agent：如果 `csc.exe` 提示输出文件被占用，通常是旧的 `AutoDetectorAgent.exe` 正在运行或被杀毒/索引占用，先关闭占用进程，或者换一个新的 `-OutputDir` 重新生成。

## 日志

Agent 日志写入：

```text
%APPDATA%\AutoDetector\tray-agent.log
```

长期启动安装失败等早期日志可能写入：

```text
%APPDATA%\AutoDetector\startup.log
```

## 安全说明

这个项目已经有后台密码登录，但仍建议只部署在内网或受控网络。

上线或跨网络使用前，建议补充：

- HTTPS/TLS。
- Agent 凭据校验，避免未知 Agent 接入。
- 更细粒度的文件操作权限。
- 操作审计日志。

文件删除是高风险操作。虽然 Agent 会拒绝删除盘符根目录，但仍应谨慎授予后台访问权限。
命令执行同样是高风险操作。建议配合更严格的登录、审计和权限边界使用。

## 限制

- 在线编辑按 UTF-8 文本处理，不适合直接编辑二进制文件。
- 下载和文本读取都会经过 WebSocket 回传，默认单文件上限是 256 MB。
- 大文件、批量复制或断点续传场景，建议后续改成分块传输。
- layui 使用 CDN，离线环境需要改成本地静态资源。
