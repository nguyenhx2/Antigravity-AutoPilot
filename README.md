# Antigravity Auto-Accept

Auto-accept Antigravity tool call prompts with a **one-click toggle** in the VS Code status bar.

## Features

- ⚡ **Status bar toggle** — Click to enable/disable auto-accept
- 🎯 **Smart targeting** — Only sends keystrokes when VS Code is focused
- ⌨️ **Keyboard shortcut** — `Ctrl+Shift+F12` to toggle
- 📊 **Accept counter** — Shows how many commands were auto-accepted
- ⚙️ **Configurable** — Adjust interval, auto-start on boot

## Installation

```powershell
# Run from this directory
.\install.ps1
```

Then reload VS Code (`Ctrl+Shift+P` → "Developer: Reload Window").

## Usage

1. Look for **`$(circle-slash) Auto-Accept: OFF`** in the status bar (bottom right)
2. Click it or press `Ctrl+Shift+F12` to toggle ON
3. When ON (⚡ yellow background), all Antigravity commands will be auto-accepted
4. Click again to turn OFF

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `antigravityAutoAccept.intervalMs` | `800` | Interval between accept attempts (ms) |
| `antigravityAutoAccept.enabledOnStartup` | `false` | Auto-enable on VS Code start |

## How It Works

Sends `Alt+A` (the Antigravity accept shortcut) via PowerShell `SendKeys` at a configurable interval, but **only** when VS Code is the foreground window.
