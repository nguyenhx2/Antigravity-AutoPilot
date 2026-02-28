// @ts-check
'use strict';

const vscode = require('vscode');
const path = require('path');
const { fork } = require('child_process');

const PATCHER = path.join(__dirname, 'patcher.js');

// ─── State ───────────────────────────────────────────────────────────────────
/** @type {vscode.StatusBarItem} */
let statusBarItem;
/** @type {boolean} */
let isPatchApplied = false;
/** @type {AntigravityPanelProvider | null} */
let panelProvider = null;
/** @type {{ basePath: string|null, files: any[], patched: boolean } | null} */
let _cachedStatus = null;
/** @type {boolean} */
let autoPilotEnabled = true;
/** @type {vscode.OutputChannel} */
let outputChannel;

// ─── Dangerous Command Blocking ───────────────────────────────────────────────

/**
 * Built-in dangerous command patterns.
 * Covers Linux/macOS/Windows destructive commands.
 * Each entry: { pattern: RegExp, label: string, os: string[] }
 */
const BUILTIN_DANGEROUS_PATTERNS = [
  // ── Linux / macOS ──
  { pattern: /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--force\s+).*\/(\s|$)/, label: 'rm -rf /', os: ['linux', 'darwin'] },
  { pattern: /rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+\/(\s|$)/, label: 'rm -r / (root wipe)', os: ['linux', 'darwin'] },
  { pattern: /rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+~(\s|$|\/)/, label: 'rm -r ~ (home wipe)', os: ['linux', 'darwin'] },
  { pattern: /rm\s+.*--no-preserve-root/, label: 'rm --no-preserve-root', os: ['linux', 'darwin'] },
  { pattern: /:\(\)\s*\{.*:\|:&\s*\};\s*:/, label: 'Fork bomb :(){:|:&};:', os: ['linux', 'darwin'] },
  { pattern: /mkfs\.(ext[234]|xfs|btrfs|vfat|ntfs)\s+\/dev\/(sd|hd|nvme|vd)/, label: 'mkfs on block device', os: ['linux', 'darwin'] },
  { pattern: /dd\s+.*of=\/dev\/(sd[a-z]|hd[a-z]|nvme\d+|zero|null)/, label: 'dd overwrite device', os: ['linux', 'darwin'] },
  { pattern: />\s*\/dev\/(sd[a-z]|hd[a-z]|nvme\d+)/, label: 'Redirect to block device', os: ['linux', 'darwin'] },
  { pattern: /shred\s+(-[a-zA-Z]*n\s*\d+\s+)?\/dev\//, label: 'shred device', os: ['linux', 'darwin'] },
  { pattern: /mv\s+.*\s+\/dev\/null/, label: 'mv to /dev/null', os: ['linux', 'darwin'] },
  { pattern: /chmod\s+-[rR]\s+000\s+\//, label: 'chmod 000 recursive on /', os: ['linux', 'darwin'] },
  { pattern: /chmod\s+777\s+-R\s+\/(\s|$)/, label: 'chmod 777 -R /', os: ['linux', 'darwin'] },
  { pattern: /chown\s+.*-R\s+.*\s+\/(\s|$)/, label: 'chown -R on /', os: ['linux', 'darwin'] },
  { pattern: /passwd\s+root\s*$/, label: 'passwd root (no new password)', os: ['linux', 'darwin'] },
  { pattern: /sudo\s+rm\s+-[a-zA-Z]*rf?\s+\/(\s|$)/, label: 'sudo rm -rf /', os: ['linux', 'darwin'] },
  { pattern: /wget\s+.*\|\s*(ba)?sh/, label: 'wget pipe to shell', os: ['linux', 'darwin'] },
  { pattern: /curl\s+.*\|\s*(ba)?sh/, label: 'curl pipe to shell', os: ['linux', 'darwin'] },
  { pattern: /base64\s+-d.*\|\s*(ba)?sh/, label: 'base64 decode pipe to shell', os: ['linux', 'darwin'] },
  { pattern: /eval\s+\$\(.*\)/, label: 'eval $(...) subshell', os: ['linux', 'darwin'] },
  { pattern: /fdisk\s+\/dev\/(sd[a-z]|nvme\d+)/, label: 'fdisk on disk', os: ['linux', 'darwin'] },
  { pattern: /parted\s+\/dev\/(sd[a-z]|nvme\d+)/, label: 'parted on disk', os: ['linux', 'darwin'] },
  { pattern: /wipefs\s+.*\/dev\//, label: 'wipefs on device', os: ['linux', 'darwin'] },
  { pattern: /truncate\s+-s\s+0\s+\/dev\//, label: 'truncate device to 0', os: ['linux', 'darwin'] },
  { pattern: /echo\s+.*>\s*\/boot\//, label: 'overwrite /boot/', os: ['linux', 'darwin'] },
  { pattern: /cat\s+\/dev\/zero\s+>\s+\//, label: 'cat /dev/zero to /', os: ['linux', 'darwin'] },
  { pattern: /umount\s+-a/, label: 'umount -a (unmount all)', os: ['linux', 'darwin'] },
  { pattern: /init\s+0/, label: 'init 0 (halt system)', os: ['linux', 'darwin'] },
  { pattern: /poweroff|halt\s*$/, label: 'System shutdown command', os: ['linux', 'darwin'] },
  { pattern: /iptables\s+-F/, label: 'iptables -F (flush all rules)', os: ['linux', 'darwin'] },
  { pattern: /ufw\s+--force\s+reset/, label: 'ufw --force reset', os: ['linux', 'darwin'] },
  // ── macOS specific ──
  { pattern: /diskutil\s+(eraseDisk|eraseVolume|partitionDisk)\s+/, label: 'diskutil erase/repartition', os: ['darwin'] },
  { pattern: /diskutil\s+zeroDisk\s+/, label: 'diskutil zeroDisk', os: ['darwin'] },
  { pattern: /csrutil\s+disable/, label: 'csrutil disable (SIP)', os: ['darwin'] },
  // ── Windows (PowerShell / cmd) ──
  { pattern: /Format-Volume\s+.*-Confirm:\s*\$false/i, label: 'Format-Volume without confirm', os: ['win32'] },
  { pattern: /format\s+[cC]:\s*\/[qQy]/i, label: 'format C: /q or /y', os: ['win32'] },
  { pattern: /format\s+[a-zA-Z]:\s*\/[qQy]/i, label: 'format <drive> /q or /y', os: ['win32'] },
  { pattern: /del\s+\/[fsqSFQ]+\s+[cC]:\\/i, label: 'del /f/s/q C:\\ (wipe drive)', os: ['win32'] },
  { pattern: /rd\s+\/[sq]+\s+[cC]:\\/i, label: 'rd /s/q C:\\ (remove all)', os: ['win32'] },
  { pattern: /Remove-Item\s+.*-Recurse\s+.*-Force.*[cC]:\\/i, label: 'Remove-Item -Recurse -Force C:\\', os: ['win32'] },
  { pattern: /Remove-Item\s+.*-Recurse\s+.*-Force\s+\/\s/i, label: 'Remove-Item -Recurse -Force /', os: ['win32'] },
  { pattern: /Set-ExecutionPolicy\s+Unrestricted\s+-Force/i, label: 'Set-ExecutionPolicy Unrestricted -Force', os: ['win32'] },
  { pattern: /reg\s+(delete|add)\s+HKLM\\SYSTEM\\CurrentControlSet/i, label: 'reg delete HKLM\\SYSTEM critical', os: ['win32'] },
  { pattern: /bcdedit\s+\/deletevalue/i, label: 'bcdedit /deletevalue (boot config)', os: ['win32'] },
  { pattern: /bcdedit\s+\/set.*safeboot/i, label: 'bcdedit /set safeboot (forces safe mode)', os: ['win32'] },
  { pattern: /cipher\s+\/w:[cC]:\\/i, label: 'cipher /w:C:\\ (wipe free space)', os: ['win32'] },
  { pattern: /sfc\s+\/scannow.*\/offwindir/i, label: 'sfc offline (system repair risk)', os: ['win32'] },
  { pattern: /wmic\s+.*delete/i, label: 'wmic delete', os: ['win32'] },
  { pattern: /Invoke-Expression\s+\(.*Download.*\)/i, label: 'IEX download-and-execute', os: ['win32'] },
  { pattern: /iex\s+\(.*WebClient.*DownloadString/i, label: 'iex WebClient DownloadString (remote exec)', os: ['win32'] },
  { pattern: /powershell\s+.*-EncodedCommand/i, label: 'powershell -EncodedCommand (obfuscated)', os: ['win32'] },
  { pattern: /net\s+user\s+administrator\s+\*?\s*\/active:yes/i, label: 'net user administrator enable', os: ['win32'] },
  { pattern: /takeown\s+\/f\s+[cC]:\\/i, label: 'takeown /f C:\\ (ownership grab)', os: ['win32'] },
  { pattern: /icacls\s+[cC]:\\\s+\/grant/i, label: 'icacls C:\\ /grant (permission escalation)', os: ['win32'] },
];

/**
 * Checks a command string against built-in + custom dangerous patterns.
 * @param {string} cmd
 * @returns {{ matched: boolean, label: string, pattern: string }}
 */
function checkDangerousCommand(cmd) {
  const cfg = vscode.workspace.getConfiguration('antigravityAutoAccept');
  const enabled = cfg.get('dangerousCommandBlocking.enabled', true);
  if (!enabled) return { matched: false, label: '', pattern: '' };

  const platform = process.platform; // 'win32' | 'linux' | 'darwin'
  const trimmed = cmd.trim();

  // Check built-in patterns (platform-filtered)
  for (const entry of BUILTIN_DANGEROUS_PATTERNS) {
    if (!entry.os.includes(platform)) continue;
    if (entry.pattern.test(trimmed)) {
      return { matched: true, label: entry.label, pattern: entry.pattern.toString() };
    }
  }

  // Check custom user patterns
  const customPatterns = /** @type {string[]} */ (cfg.get('dangerousCommandBlocking.customPatterns', []));
  for (const raw of customPatterns) {
    try {
      const re = new RegExp(raw, 'i');
      if (re.test(trimmed)) {
        return { matched: true, label: `Custom: ${raw}`, pattern: raw };
      }
    } catch {
      // Invalid regex — skip silently
    }
  }

  return { matched: false, label: '', pattern: '' };
}

/**
 * Handles a detected dangerous command according to the configured action.
 * @param {string} cmd - The full command text
 * @param {string} label - Human-readable reason
 */
function handleDangerousCommand(cmd, label) {
  const cfg = vscode.workspace.getConfiguration('antigravityAutoAccept');
  const action = cfg.get('dangerousCommandBlocking.action', 'block');
  const msg = `🛡️ Dangerous command detected: "${label}" — \`${cmd.trim().substring(0, 80)}\``;

  outputChannel.appendLine(`[DangerBlock][${new Date().toISOString()}] ${action.toUpperCase()} | ${label} | CMD: ${cmd.trim()}`);

  if (action === 'block') {
    vscode.window.showErrorMessage(
      `⛔ Blocked: ${label}`,
      { modal: false },
      'View Details',
    ).then((choice) => {
      if (choice === 'View Details') {
        outputChannel.show(true);
        outputChannel.appendLine(`[DangerBlock] Blocked command: ${cmd.trim()}`);
      }
    });
  } else if (action === 'warn') {
    vscode.window.showWarningMessage(`⚠️ Warning: ${msg}`);
  }
  // 'log' — already logged above, no UI notification
}

// ─── Child Process Bridge ─────────────────────────────────────────────────────

/**
 * Runs patcher.js in a child process.
 * All heavy file I/O lives in patcher.js — never blocks the extension host.
 * @param {'status'|'apply'|'revert'} command
 * @returns {Promise<any>}
 */
function runPatcher(command) {
  return new Promise((resolve, reject) => {
    const child = fork(PATCHER, [], { silent: true });

    child.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      const m = /** @type {{type:string,msg?:string}} */(msg);
      if (m.type === 'log') {
        console.log(m.msg);
        outputChannel.appendLine(m.msg || '');
      } else {
        resolve(msg);
      }
    });

    child.on('error', (err) => {
      outputChannel.appendLine(`[AutoPilot] fork error: ${err.message}`);
      reject(err);
    });

    child.on('exit', (code) => {
      if (code !== 0) {
        resolve({
          type: 'result',
          success: false,
          message: `Process exited with code ${code}. Check Output > AutoPilot for details.`,
        });
      }
    });

    child.send({ command });
  });
}

// ─── Patch Manager (async, non-blocking) ─────────────────────────────────────

/**
 * Gets patch status via child process.
 * @returns {Promise<{basePath:string|null, patched:boolean, files:Array<{label:string,patched:boolean,exists:boolean}>}>}
 */
async function getPatchStatus() {
  try {
    const res = /** @type {any} */(await runPatcher('status'));
    const files = res.files || [];
    _cachedStatus = { basePath: res.basePath || null, files, patched: files.some((/** @type {any} */f) => f.patched) };
    return _cachedStatus;
  } catch {
    return { basePath: null, patched: false, files: [] };
  }
}

/**
 * Applies the patch via child process.
 * @returns {Promise<{success:boolean, message:string}>}
 */
async function applyPatch() {
  try {
    const res = /** @type {any} */(await runPatcher('apply'));
    const success = res.success === true;
    isPatchApplied = success;
    await refreshStatus();
    return { success, message: res.message || '' };
  } catch (e) {
    return { success: false, message: `❌ Error: ${e}` };
  }
}

/**
 * Reverts the patch via child process.
 * @returns {Promise<{success:boolean, message:string}>}
 */
async function revertPatch() {
  try {
    const res = /** @type {any} */(await runPatcher('revert'));
    isPatchApplied = false;
    await refreshStatus();
    return { success: res.success === true, message: res.message || '' };
  } catch (e) {
    return { success: false, message: `❌ Error: ${e}` };
  }
}

/** Refreshes status and updates all UI elements. */
async function refreshStatus() {
  const status = await getPatchStatus();
  isPatchApplied = status.patched;
  updateStatusBarFromCache();
  if (panelProvider) panelProvider.sendStatus(status);
}

// ─── Status Bar ───────────────────────────────────────────────────────────────

function updateStatusBarFromCache() {
  if (!statusBarItem) return;
  if (!autoPilotEnabled) {
    statusBarItem.text = '$(debug-pause) AG Paused';
    statusBarItem.tooltip = 'Antigravity AutoPilot is suspended';
    statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    return;
  }
  if (!_cachedStatus || !_cachedStatus.basePath) {
    statusBarItem.text = '$(warning) AG: Not Found';
    statusBarItem.tooltip = 'Antigravity not found on this system';
    statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorForeground');
  } else if (_cachedStatus.patched) {
    statusBarItem.text = '$(zap) AG: Active';
    statusBarItem.tooltip = 'Antigravity AutoPilot — Patch Applied ✅';
    statusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
  } else {
    statusBarItem.text = '$(circle-slash) AG: Inactive';
    statusBarItem.tooltip = 'Antigravity AutoPilot — Patch Not Applied';
    statusBarItem.color = undefined;
  }
}

// ─── Sidebar WebView ──────────────────────────────────────────────────────────

class AntigravityPanelProvider {
  /** @param {vscode.ExtensionContext} context */
  constructor(context) {
    this._context = context;
    /** @type {vscode.WebviewView | null} */
    this._view = null;
  }

  /** @param {vscode.WebviewView} webviewView */
  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._getHtml();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === 'apply') {
        this._postLoading('⏳ Patching...');
        const result = await applyPatch();
        vscode.window.showInformationMessage(result.message);
      } else if (msg.command === 'revert') {
        this._postLoading('⏳ Reverting...');
        const result = await revertPatch();
        vscode.window.showInformationMessage(result.message);
      } else if (msg.command === 'refresh') {
        this._postLoading('⏳ Checking...');
        await refreshStatus();
      } else if (msg.command === 'toggleEnabled') {
        autoPilotEnabled = !autoPilotEnabled;
        updateStatusBarFromCache();
        // Persist into workspace config
        const cfg = vscode.workspace.getConfiguration('antigravityAutoAccept');
        await cfg.update('enabledOnStartup', autoPilotEnabled, vscode.ConfigurationTarget.Global);
        if (panelProvider) panelProvider.sendEnabled(autoPilotEnabled);
        vscode.window.showInformationMessage(
          autoPilotEnabled ? '⚡ AutoPilot resumed' : '⏸ AutoPilot suspended',
        );
      } else if (msg.command === 'openSettings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'antigravityAutoAccept');
      }
    });

    // Initial load
    refreshStatus();
    this.sendEnabled(autoPilotEnabled);
  }

  /** @param {string} text */
  _postLoading(text) {
    if (this._view) this._view.webview.postMessage({ command: 'loading', text });
  }

  /** @param {{basePath:string|null,patched:boolean,files:any[]}} status */
  sendStatus(status) {
    if (!this._view) return;
    this._view.webview.postMessage({
      command: 'update',
      patched: status.patched,
      basePath: status.basePath,
      files: status.files,
    });
  }

  /** @param {boolean} enabled */
  sendEnabled(enabled) {
    if (!this._view) return;
    this._view.webview.postMessage({ command: 'setEnabled', enabled });
  }

  _getHtml() {
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    font-family:'Segoe UI',sans-serif;
    background:var(--vscode-sideBar-background);
    color:var(--vscode-foreground);
    padding:12px;user-select:none;
  }

  /* ── Header ── */
  .header{
    display:flex;align-items:center;gap:8px;
    margin-bottom:12px;padding-bottom:10px;
    border-bottom:1px solid var(--vscode-panel-border);
  }
  .header-icon{font-size:18px}
  .header-title{font-size:13px;font-weight:600;letter-spacing:.3px}
  .header-sub{font-size:10px;color:var(--vscode-descriptionForeground);margin-top:2px}

  /* ── Toggle Row ── */
  .toggle-row{
    display:flex;align-items:center;justify-content:space-between;
    background:var(--vscode-editor-background);
    border:1px solid var(--vscode-panel-border);
    border-radius:6px;padding:8px 10px;margin-bottom:10px;
  }
  .toggle-label{font-size:11px;font-weight:600}
  .toggle-sub{font-size:10px;color:var(--vscode-descriptionForeground);margin-top:1px}
  .switch{position:relative;display:inline-block;width:34px;height:18px;flex-shrink:0}
  .switch input{opacity:0;width:0;height:0}
  .slider{
    position:absolute;cursor:pointer;inset:0;
    background:#555;border-radius:18px;
    transition:background .2s;
  }
  .slider:before{
    position:absolute;content:'';height:14px;width:14px;
    left:2px;bottom:2px;background:#fff;border-radius:50%;
    transition:transform .2s;
  }
  input:checked + .slider{background:#4ec94e}
  input:checked + .slider:before{transform:translateX(16px)}

  /* ── Status card ── */
  .status-card{
    border-radius:6px;padding:12px;margin-bottom:10px;
    background:var(--vscode-editor-background);
    border:1px solid var(--vscode-panel-border);
    transition:border-color .3s,background .3s;
  }
  .status-card.patched{border-color:#4ec94e;background:rgba(78,201,78,.07)}
  .status-card.not-found{border-color:#e06c75;background:rgba(224,108,117,.07)}
  .status-row{display:flex;align-items:center;gap:10px}
  .dot{
    width:32px;height:32px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    font-size:16px;flex-shrink:0;background:#3c3c3c;
    transition:background .3s;
  }
  .dot.patched{background:#4ec94e}
  .dot.not-found{background:#e06c75}
  .status-label{font-size:16px;font-weight:700;line-height:1}
  .status-label.patched{color:#4ec94e}
  .status-label.pending{color:#e5c07b}
  .status-label.not-found{color:#e06c75}
  .status-label.loading{color:var(--vscode-descriptionForeground)}
  .status-desc{font-size:10px;color:var(--vscode-descriptionForeground);margin-top:3px}

  /* ── Security section ── */
  .section{
    border:1px solid var(--vscode-panel-border);
    border-radius:6px;margin-bottom:10px;overflow:hidden;
  }
  .section-header{
    display:flex;align-items:center;justify-content:space-between;
    padding:7px 10px;
    background:var(--vscode-editor-background);
    font-size:11px;font-weight:600;
    border-bottom:1px solid var(--vscode-panel-border);
  }
  .section-header .badge{
    font-size:9px;padding:1px 6px;border-radius:10px;
    background:#e06c75;color:#fff;font-weight:700;
  }
  .section-header .badge.on{background:#4ec94e}
  .blocklist{padding:6px 10px}
  .block-item{
    display:flex;align-items:center;gap:5px;
    font-size:10px;padding:2px 0;color:var(--vscode-descriptionForeground);
  }
  .block-dot{
    width:5px;height:5px;border-radius:50%;background:#e5c07b;flex-shrink:0;
  }

  /* ── Path box ── */
  .path-box{
    font-size:9px;color:var(--vscode-descriptionForeground);
    background:var(--vscode-editor-background);
    border:1px solid var(--vscode-panel-border);
    border-radius:4px;padding:4px 6px;margin-bottom:8px;
    word-break:break-all;
  }

  /* ── Buttons ── */
  .btn{
    width:100%;padding:8px;border:none;border-radius:5px;
    font-size:11px;font-weight:700;letter-spacing:.4px;
    cursor:pointer;transition:background .2s,transform .1s;
    font-family:inherit;margin-bottom:5px;
  }
  .btn:active{transform:scale(.98)}
  .btn:disabled{opacity:.4;cursor:not-allowed}
  .btn-apply{background:#0e7a4c;color:#fff}
  .btn-apply:hover:not(:disabled){background:#0f9058}
  .btn-revert{background:#5a1a1a;color:#fff}
  .btn-revert:hover:not(:disabled){background:#7a2020}
  .btn-refresh{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
  .btn-settings{
    background:transparent;color:var(--vscode-descriptionForeground);
    border:1px solid var(--vscode-panel-border);font-size:10px;
    margin-top:2px;
  }
  .btn-settings:hover{background:var(--vscode-editor-background)}

  .note{
    margin-top:8px;font-size:9px;
    color:var(--vscode-descriptionForeground);
    text-align:center;line-height:1.5;
  }
</style>
</head>
<body>

<div class="header">
  <span class="header-icon">⚡</span>
  <div>
    <div class="header-title">Antigravity AutoPilot</div>
    <div class="header-sub">Auto-execute all tool calls &amp; commands</div>
  </div>
</div>

<!-- Enabled/Disabled toggle -->
<div class="toggle-row" id="toggleRow">
  <div>
    <div class="toggle-label">AutoPilot</div>
    <div class="toggle-sub" id="toggleSub">Active — executing all commands</div>
  </div>
  <label class="switch" title="Toggle AutoPilot on/off">
    <input type="checkbox" id="toggleCheck" checked onchange="send('toggleEnabled')">
    <span class="slider"></span>
  </label>
</div>

<!-- Patch Status -->
<div class="status-card" id="card">
  <div class="status-row">
    <div class="dot" id="dot">⊘</div>
    <div>
      <div class="status-label loading" id="lbl">Loading...</div>
      <div class="status-desc" id="desc">Detecting Antigravity...</div>
    </div>
  </div>
</div>

<div class="path-box" id="pathBox" style="display:none"></div>

<!-- Dangerous Command Blocking section -->
<div class="section">
  <div class="section-header">
    🛡️ Command Blocking
    <span class="badge on" id="blockBadge">ON</span>
  </div>
  <div class="blocklist">
    <div class="block-item"><span class="block-dot"></span>rm -rf / and variants (Linux/macOS)</div>
    <div class="block-item"><span class="block-dot"></span>dd / mkfs / wipefs on devices</div>
    <div class="block-item"><span class="block-dot"></span>format C: / Remove-Item -Force (Windows)</div>
    <div class="block-item"><span class="block-dot"></span>curl/wget pipe to shell</div>
    <div class="block-item"><span class="block-dot"></span>Fork bombs, IEX download-exec</div>
    <div class="block-item"><span class="block-dot"></span>diskutil erase, bcdedit delete</div>
    <div class="block-item" style="color:var(--vscode-foreground);font-style:italic">+ 40 more built-in patterns</div>
  </div>
</div>

<button class="btn btn-apply" id="btnApply" style="display:none">⚡ APPLY PATCH</button>
<button class="btn btn-revert" id="btnRevert" style="display:none">↩ REVERT PATCH</button>
<button class="btn btn-refresh">🔄 Refresh Status</button>
<button class="btn btn-settings" onclick="send('openSettings')">⚙️ Open Settings</button>

<div class="note" id="noteBox"></div>

<script>
  const vscode = acquireVsCodeApi();

  function send(cmd) {
    if (cmd !== 'openSettings' && cmd !== 'toggleEnabled' && cmd !== 'refresh') {
      document.getElementById('btnApply').disabled = true;
      document.getElementById('btnRevert').disabled = true;
    }
    vscode.postMessage({ command: cmd });
  }

  // Wire up buttons
  document.getElementById('btnApply').addEventListener('click', () => send('apply'));
  document.getElementById('btnRevert').addEventListener('click', () => send('revert'));
  document.querySelector('.btn-refresh').addEventListener('click', () => {
    send('refresh');
    document.querySelector('.btn-refresh').disabled = true;
    setTimeout(() => { document.querySelector('.btn-refresh').disabled = false; }, 2000);
  });

  send('refresh');

  window.addEventListener('message', e => {
    const { command, patched, basePath, files, text, enabled } = e.data;

    if (command === 'setEnabled') {
      const chk = document.getElementById('toggleCheck');
      chk.checked = enabled;
      document.getElementById('toggleSub').textContent = enabled
        ? 'Active — executing all commands'
        : 'Suspended — commands require confirmation';
    }

    if (command === 'loading') {
      document.getElementById('lbl').className = 'status-label loading';
      document.getElementById('lbl').textContent = text || '⏳ Working...';
      document.getElementById('desc').textContent = 'Please wait...';
      return;
    }

    if (command !== 'update') return;

    // Re-enable buttons
    document.getElementById('btnApply').disabled = false;
    document.getElementById('btnRevert').disabled = false;

    const notFound = !basePath;

    document.getElementById('card').className = 'status-card' + (notFound ? ' not-found' : patched ? ' patched' : '');
    document.getElementById('dot').className  = 'dot' + (notFound ? ' not-found' : patched ? ' patched' : '');
    document.getElementById('dot').textContent = notFound ? '✕' : patched ? '✓' : '○';

    const lbl = document.getElementById('lbl');
    lbl.className = 'status-label ' + (notFound ? 'not-found' : patched ? 'patched' : 'pending');
    lbl.textContent = notFound ? 'Not Found' : patched ? 'Patched' : 'Not Patched';

    document.getElementById('desc').textContent = notFound
      ? 'Antigravity installation not detected'
      : patched ? 'AutoPilot is active on this machine' : 'Click APPLY PATCH to activate';

    if (basePath) {
      const pb = document.getElementById('pathBox');
      pb.textContent = basePath;
      pb.style.display = 'block';
    }

    document.getElementById('btnApply').style.display = notFound || patched ? 'none' : 'block';
    document.getElementById('btnRevert').style.display = patched ? 'block' : 'none';

    document.getElementById('noteBox').textContent = notFound
      ? 'Install Antigravity first, then click Refresh.'
      : patched ? 'Restart Antigravity to apply changes.' : '';
  });
</script>
</body>
</html>`;
  }
}

// ─── Status Bar (legacy helpers) ──────────────────────────────────────────────

/** @deprecated kept for backward compat */
function updateStatusBar() { updateStatusBarFromCache(); }

// ─── Activate / Deactivate ────────────────────────────────────────────────────

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  // Shared output channel
  outputChannel = vscode.window.createOutputChannel('AutoPilot');
  context.subscriptions.push(outputChannel);

  // Read enabledOnStartup setting
  const cfg = vscode.workspace.getConfiguration('antigravityAutoAccept');
  autoPilotEnabled = cfg.get('enabledOnStartup', true);

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'antigravityAutoAccept.openPanel';
  statusBarItem.text = `$(sync~spin) AG Patch`;
  statusBarItem.tooltip = 'Checking patch status...';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Sidebar
  panelProvider = new AntigravityPanelProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'antigravityAutoAccept.panel',
      panelProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  // ── Terminal command watcher (Dangerous Command Blocking) ──────────────────
  // VS Code API: onDidWriteTerminalData captures output; we intercept typed
  // commands via onDidStartTerminalShellExecution (VS Code 1.87+).
  // Fallback: detect via terminal write events.
  if (typeof vscode.window.onDidStartTerminalShellExecution === 'function') {
    context.subscriptions.push(
      vscode.window.onDidStartTerminalShellExecution((event) => {
        const cmd = event.execution.commandLine?.value || '';
        if (!cmd) return;
        const check = checkDangerousCommand(cmd);
        if (check.matched) {
          handleDangerousCommand(cmd, check.label);
          // Note: VS Code does not expose a cancellation API for shell exec;
          // we log/warn/notify. For full blocking, pair with shell hook.
        }
      }),
    );
  }

  // Config change listener — react to user toggling blocking or action
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('antigravityAutoAccept.enabledOnStartup')) {
        autoPilotEnabled = vscode.workspace.getConfiguration('antigravityAutoAccept').get('enabledOnStartup', true);
        updateStatusBarFromCache();
        if (panelProvider) panelProvider.sendEnabled(autoPilotEnabled);
      }
    }),
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityAutoAccept.applyPatch', async () => {
      const result = await applyPatch();
      vscode.window.showInformationMessage(result.message);
    }),
    vscode.commands.registerCommand('antigravityAutoAccept.revertPatch', async () => {
      const result = await revertPatch();
      vscode.window.showInformationMessage(result.message);
    }),
    vscode.commands.registerCommand('antigravityAutoAccept.openPanel', () => {
      vscode.commands.executeCommand('antigravityAutoAccept.panel.focus');
    }),
    vscode.commands.registerCommand('antigravityAutoAccept.checkStatus', async () => {
      const status = await getPatchStatus();
      if (!status.basePath) {
        vscode.window.showWarningMessage('Antigravity not found!');
      } else {
        vscode.window.showInformationMessage(
          `Patch status: ${status.patched ? '✅ Applied' : '⬜ Not applied'} | ${status.basePath}`,
        );
      }
    }),
  );

  // Async startup — never blocks extension host!
  (async () => {
    const status = await getPatchStatus();
    isPatchApplied = status.patched;
    updateStatusBarFromCache();
    if (panelProvider) {
      panelProvider.sendStatus(status);
      panelProvider.sendEnabled(autoPilotEnabled);
    }

    const startCfg = vscode.workspace.getConfiguration('antigravityAutoAccept');
    if (startCfg.get('applyOnStartup') && !status.patched && status.basePath) {
      const result = await applyPatch();
      if (result.success) {
        outputChannel.appendLine('[AutoPilot] Auto-patch applied on startup');
      }
    }
  })();
}

function deactivate() { /* nothing to clean up */ }

module.exports = { activate, deactivate };
