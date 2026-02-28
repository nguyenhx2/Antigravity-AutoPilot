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
    const channel = vscode.window.createOutputChannel('AutoAccept');

    child.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      const m = /** @type {{type:string,msg?:string}} */(msg);
      if (m.type === 'log') {
        console.log(m.msg);
        channel.appendLine(m.msg || '');
      } else {
        resolve(msg); // status or result message
      }
    });

    child.on('error', (err) => {
      channel.appendLine(`[AutoAccept] fork error: ${err.message}`);
      reject(err);
    });

    child.on('exit', (code) => {
      if (code !== 0) {
        resolve({
          type: 'result',
          success: false,
          message: `Process exited with code ${code}. Check Output > AutoAccept for details.`,
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

// ─── Sidebar WebView ──────────────────────────────────────────────────────

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
      }
    });

    // Initial load
    refreshStatus();
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

  /** @deprecated use sendStatus */
  updateState() { refreshStatus(); }

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
    padding:16px;user-select:none;
  }
  .header{
    display:flex;align-items:center;gap:8px;
    margin-bottom:16px;padding-bottom:12px;
    border-bottom:1px solid var(--vscode-panel-border);
  }
  .header-icon{font-size:20px}
  .header-title{font-size:13px;font-weight:600;letter-spacing:.3px}
  .header-sub{font-size:11px;color:var(--vscode-descriptionForeground);margin-top:2px}

  .status-card{
    border-radius:8px;padding:16px;margin-bottom:12px;
    background:var(--vscode-editor-background);
    border:1px solid var(--vscode-panel-border);
    transition:border-color .3s,background .3s;
  }
  .status-card.patched{border-color:#4ec94e;background:rgba(78,201,78,.07)}
  .status-card.not-found{border-color:#e06c75;background:rgba(224,108,117,.07)}
  .status-row{display:flex;align-items:center;gap:12px}
  .dot{
    width:36px;height:36px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    font-size:18px;flex-shrink:0;background:#3c3c3c;
    transition:background .3s;
  }
  .dot.patched{background:#4ec94e}
  .dot.not-found{background:#e06c75}
  .status-label{font-size:18px;font-weight:700;line-height:1}
  .status-label.patched{color:#4ec94e}
  .status-label.pending{color:#e5c07b}
  .status-label.not-found{color:#e06c75}
  .status-label.loading{color:var(--vscode-descriptionForeground)}
  .status-desc{font-size:11px;color:var(--vscode-descriptionForeground);margin-top:4px}

  .path-box{
    font-size:10px;color:var(--vscode-descriptionForeground);
    background:var(--vscode-editor-background);
    border:1px solid var(--vscode-panel-border);
    border-radius:4px;padding:6px 8px;margin-bottom:10px;
    word-break:break-all;
  }

  .files-list{margin-bottom:12px}
  .file-item{
    display:flex;align-items:center;gap:6px;
    font-size:11px;padding:4px 0;
  }
  .file-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
  .file-dot.patched{background:#4ec94e}
  .file-dot.pending{background:#e5c07b}

  .btn{
    width:100%;padding:10px;border:none;border-radius:6px;
    font-size:12px;font-weight:700;letter-spacing:.5px;
    cursor:pointer;transition:background .2s,transform .1s;
    font-family:inherit;margin-bottom:6px;
  }
  .btn:active{transform:scale(.98)}
  .btn:disabled{opacity:.5;cursor:not-allowed}
  .btn-apply{background:#0e7a4c;color:#fff}
  .btn-apply:hover:not(:disabled){background:#0f9058}
  .btn-revert{background:#5a1a1a;color:#fff}
  .btn-revert:hover:not(:disabled){background:#7a2020}
  .btn-refresh{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}

  .note{
    margin-top:10px;font-size:10px;
    color:var(--vscode-descriptionForeground);
    text-align:center;line-height:1.5;
  }
</style>
</head>
<body>
<div class="header">
  <span class="header-icon">⚡</span>
  <div>
    <div class="header-title">Antigravity Auto-Accept</div>
    <div class="header-sub">Patches "Always Proceed" to auto-run</div>
  </div>
</div>

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

<div class="files-list" id="filesList"></div>

<button class="btn btn-apply" id="btnApply" onclick="send('apply')" style="display:none">⚡ APPLY PATCH</button>
<button class="btn btn-revert" id="btnRevert" onclick="send('revert')" style="display:none">↩ REVERT PATCH</button>
<button class="btn btn-refresh" onclick="send('refresh')">🔄 Refresh Status</button>

<div class="note" id="noteBox"></div>

<script>
  const vscode = acquireVsCodeApi();
  function send(cmd) {
    document.getElementById('btnApply').disabled = true;
    document.getElementById('btnRevert').disabled = true;
    document.getElementById('btnRefresh') && (document.getElementById('btnRefresh').disabled = true);
    vscode.postMessage({ command: cmd });
  }
  send('refresh');

  window.addEventListener('message', e => {
    const { command, patched, basePath, files, text } = e.data;

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
    lbl.textContent = notFound ? 'NOT FOUND' : patched ? 'PATCHED' : 'NOT PATCHED';

    document.getElementById('desc').textContent = notFound
      ? 'Antigravity not installed'
      : patched
        ? 'useEffect added — restart Antigravity!'
        : 'Patch not applied yet';

    const pathBox = document.getElementById('pathBox');
    if (basePath) {
      pathBox.textContent = '📍 ' + basePath;
      pathBox.style.display = '';
    } else {
      pathBox.style.display = 'none';
    }

    const filesList = document.getElementById('filesList');
    filesList.innerHTML = '';
    if (files && files.length) {
      for (const f of files) {
        const d = document.createElement('div');
        d.className = 'file-item';
        d.innerHTML = '<div class="file-dot ' + (f.patched ? 'patched' : 'pending') + '"></div>'
          + '<span>' + f.label + ': ' + (f.patched ? '✅ patched' : '⬜ not patched') + '</span>';
        filesList.appendChild(d);
      }
    }

    document.getElementById('btnApply').style.display = (notFound || patched) ? 'none' : '';
    document.getElementById('btnRevert').style.display = patched ? '' : 'none';

    document.getElementById('noteBox').textContent = notFound
      ? '⚠️ Install Antigravity first'
      : patched
        ? '💡 Re-run after Antigravity updates'
        : '💡 Apply patch once, then restart Antigravity';
  });
</script>
</body>
</html>`;
  }
}

// ─── Status Bar ──────────────────────────────────────────────────────────

function updateStatusBarFromCache() {
  const status = _cachedStatus;
  if (!status || !status.basePath) {
    statusBarItem.text = `$(warning) AG Patch: Not Found`;
    statusBarItem.tooltip = 'Antigravity not detected';
    statusBarItem.backgroundColor = undefined;
  } else if (status.patched) {
    statusBarItem.text = `$(check) AG Patch: Active`;
    statusBarItem.tooltip = 'Auto-Accept patch is applied — click to manage';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    statusBarItem.text = `$(zap) AG Patch: OFF`;
    statusBarItem.tooltip = 'Auto-Accept patch not applied — click to open panel';
    statusBarItem.backgroundColor = undefined;
  }
}

/** @deprecated kept for backward compat */
function updateStatusBar() { updateStatusBarFromCache(); }

// ─── Activate / Deactivate ──────────────────────────────────────────────

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  // Status bar — shows spinner until first async check completes
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'antigravityAutoAccept.openPanel';
  statusBarItem.text = `$(sync~spin) AG Patch`;
  statusBarItem.tooltip = 'Checking patch status...';
  statusBarItem.show();

  // Sidebar
  panelProvider = new AntigravityPanelProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'antigravityAutoAccept.panel',
      panelProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
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

  context.subscriptions.push(statusBarItem);

  // Async startup — never blocks extension host!
  (async () => {
    const status = await getPatchStatus();
    isPatchApplied = status.patched;
    updateStatusBarFromCache();
    if (panelProvider) panelProvider.sendStatus(status);

    const cfg = vscode.workspace.getConfiguration('antigravityAutoAccept');
    if (cfg.get('applyOnStartup') && !status.patched && status.basePath) {
      const result = await applyPatch();
      if (result.success) {
        console.log('[AutoAccept] Auto-patch applied on startup');
      }
    }
  })();
}

function deactivate() { /* nothing to clean up */ }

module.exports = { activate, deactivate };
