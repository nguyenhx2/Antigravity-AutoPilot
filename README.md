# Antigravity AutoPilot

<p align="center">
  <img src="https://raw.githubusercontent.com/nguyenhx2/Antigravity-AutoPilot/master/icon.png" width="128" alt="Antigravity AutoPilot Logo">
</p>

> Automatically execute all tool calls and terminal commands in Antigravity — no manual confirmation needed.

[![npm](https://img.shields.io/npm/v/antigravity-autopilot)](https://www.npmjs.com/package/antigravity-autopilot)
[![GitHub](https://img.shields.io/badge/GitHub-Antigravity--AutoPilot-blue)](https://github.com/nguyenhx2/Antigravity-AutoPilot)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## What it does

Antigravity has an **"Always Proceed"** terminal execution policy, but due to a missing `useEffect` in its bundled JS, the policy never actually fires — commands still wait for manual approval.

**Antigravity AutoPilot** patches the runtime JS bundle to inject the missing auto-accept logic, so every tool call and terminal command runs instantly when the policy is active.

- ✅ Regex-based matching — works across Antigravity versions
- ✅ Non-destructive — creates `.bak` backup before patching
- ✅ Reversible — restore originals anytime with `--revert`
- ✅ Available as VS Code Extension **and** CLI (`npx`)
- 🛡️ 54+ built-in dangerous command presets (Linux/macOS/Windows)
- 🔘 On/Off toggle for Command Blocking directly from sidebar
- ⚙️ Fully customizable preset management with Reset Defaults

---

## CLI Usage

```bash
# Apply the autopilot patch
npx antigravity-autopilot

# Check if already patched
npx antigravity-autopilot --check

# Revert to original files
npx antigravity-autopilot --revert
```

### Workflow

```
1. npx antigravity-autopilot   →  patch applied
2. Restart Antigravity          →  AutoPilot active 🚀
3. npx antigravity-autopilot --revert   →  undo anytime
```

---

## VS Code Extension

Install the extension directly into Antigravity for a UI-based experience (sidebar panel, status bar, apply/revert commands):

```bash
# Download .vsix from GitHub Releases, then:
antigravity --install-extension antigravity-autopilot-1.4.0.vsix
```

**Extension features:**
- ⚡ Sidebar panel with one-click Apply / Revert
- 📊 Status bar showing current patch state
- ⌨️ Keyboard shortcut: `Ctrl+Shift+F12`
- ⚙️ `applyOnStartup` setting for fully automatic operation
- 🔘 `enabledOnStartup` — toggle AutoPilot active/suspended on launch
- 🛡️ **Command Blocking On/Off** — toggle dangerous command blocking directly from the sidebar UI
- 📋 **Preset Management** — view, remove, and reset 54+ built-in dangerous command presets

---

## 🛡️ Dangerous Command Blocking

Built-in protection against destructive commands. **54+ preset patterns** covering all major platforms:

| Platform | Examples |
|----------|----------|
| **Linux/macOS** | `rm -rf /`, `dd of=/dev/sda`, `mkfs`, fork bombs, `curl \| sh`, `chmod 777 -R /` |
| **macOS** | `diskutil eraseDisk`, `csrutil disable` |
| **Windows** | `format C:`, `Remove-Item -Recurse C:\`, `bcdedit /deletevalue`, `IEX download-and-exec` |

### Sidebar Controls

- 🔘 **On/Off Toggle** — enable or disable command blocking with a single switch
- 📋 **View all presets** — full list of blocked commands with OS badges (LNX/MAC/WIN)
- ✕ **Remove individual presets** — click the ✕ button to exclude a preset
- 🔄 **Reset Defaults** — restore all removed presets with one click
- 📊 **Active count** — always see how many presets are active
- 🔅 **Visual feedback** — presets section dims when blocking is disabled

### Custom Patterns

Add your own patterns via Settings:

```json
"antigravityAutoAccept.dangerousCommandBlocking.customPatterns": [
  "^my-dangerous-script",
  "DROP TABLE"
]
```

### Action Modes

| Mode | Behavior |
|------|----------|
| `block` | Block command + show error notification (default) |
| `warn` | Show warning but allow command to proceed |
| `log` | Silently log to Output channel |

---

## How it works

Antigravity bundles its UI as minified JavaScript. The patch locates the `setTerminalAutoExecutionPolicy` onChange handler and injects a `useEffect` that fires the auto-confirm function whenever the policy is set to `EAGER`:

```js
// Injected patch (conceptual):
useEffect(() => {
  if (policyVar === ENUM.EAGER && !secureMode) confirmFn(true);
}, []);
```

Variable names are resolved via regex at runtime, making the patch resilient to minification changes between versions.

---

## Requirements

- [Antigravity](https://antigravity.dev) installed on your system
- Node.js 16+

---

## Repository

[github.com/nguyenhx2/Antigravity-AutoPilot](https://github.com/nguyenhx2/Antigravity-AutoPilot)

## License

[MIT](LICENSE) — Copyright (c) 2026 Nguyen Hoang (nguyenhx2 or Brian)
