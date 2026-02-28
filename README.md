# Antigravity AutoPilot

> Automatically execute all tool calls and terminal commands in Antigravity — no manual confirmation needed.

[![npm](https://img.shields.io/npm/v/antigravity-autopilot)](https://www.npmjs.com/package/antigravity-autopilot)
[![GitHub](https://img.shields.io/badge/GitHub-Antigravity--AutoPilot-blue)](https://github.com/nguyenhx2/Antigravity-AutoPilot)

---

## What it does

Antigravity has an **"Always Proceed"** terminal execution policy, but due to a missing `useEffect` in its bundled JS, the policy never actually fires — commands still wait for manual approval.

**Antigravity AutoPilot** patches the runtime JS bundle to inject the missing auto-accept logic, so every tool call and terminal command runs instantly when the policy is active.

- ✅ Regex-based matching — works across Antigravity versions
- ✅ Non-destructive — creates `.bak` backup before patching
- ✅ Reversible — restore originals anytime with `--revert`
- ✅ Available as VS Code Extension **and** CLI (`npx`)

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
antigravity --install-extension antigravity-autopilot-1.0.0.vsix
```

**Extension features:**
- ⚡ Sidebar panel with one-click Apply / Revert
- 📊 Status bar showing current patch state
- ⌨️ Keyboard shortcut: `Ctrl+Shift+F12`
- ⚙️ `applyOnStartup` setting for fully automatic operation

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

MIT
