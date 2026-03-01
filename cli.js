#!/usr/bin/env node

/**
 * Antigravity AutoPilot — CLI v1.4.0
 * ====================================
 *   npx antigravity-autopilot                Apply all patches
 *   npx antigravity-autopilot --only terminal  Patch terminal only
 *   npx antigravity-autopilot --only browser   Patch browser only
 *   npx antigravity-autopilot --only file      Patch file only
 *   npx antigravity-autopilot --check        Check status
 *   npx antigravity-autopilot --revert       Restore originals
 *   npx antigravity-autopilot --help         Show help
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── ANSI Colors (auto-disable when not a TTY) ───────────────────────────────

const isTTY = process.stdout.isTTY;
const c = {
    reset: isTTY ? '\x1b[0m' : '',
    bold: isTTY ? '\x1b[1m' : '',
    dim: isTTY ? '\x1b[2m' : '',
    yellow: isTTY ? '\x1b[33m' : '',
    cyan: isTTY ? '\x1b[36m' : '',
    green: isTTY ? '\x1b[32m' : '',
    red: isTTY ? '\x1b[31m' : '',
    blue: isTTY ? '\x1b[34m' : '',
    magenta: isTTY ? '\x1b[35m' : '',
    white: isTTY ? '\x1b[97m' : '',
    gray: isTTY ? '\x1b[90m' : '',
    bgBlue: isTTY ? '\x1b[44m' : '',
};

const W = 60; // box inner width (ASCII-safe)

function repeat(ch, n) { return ch.repeat(Math.max(0, n)); }
function pad(str, n) {
    const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
    return str + repeat(' ', Math.max(0, n - visible.length));
}

// --- Banner ------------------------------------------------------------------

function printBanner() {
    const logoLines = [
        '\u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2557   \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 ',
        '\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557 \u2588\u2588\u2551   \u2588\u2588\u2551\u255a\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255d\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557',
        '\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551  \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551',
        '\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551  \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551',
        '\u2588\u2588\u2551  \u2588\u2588\u2551  \u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d   \u2588\u2588\u2551   \u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d',
        '\u255a\u2550\u255d  \u255a\u2550\u255d   \u255a\u2550\u2550\u2550\u2550\u2550\u255d    \u255a\u2550\u255d    \u255a\u2550\u2550\u2550\u2550\u2550\u255d ',
    ];

    const pkg = require('./package.json');
    const sub = '\u26a1  A N T I G R A V I T Y   A U T O P I L O T  \u26a1';
    const ver = `v${pkg.version}  \u00b7  MIT License`;

    console.log('');
    for (const line of logoLines) {
        console.log(c.yellow + c.bold + '   ' + line + c.reset);
    }
    console.log('');
    console.log(c.cyan + c.bold + '   ' + sub + c.reset);
    console.log(c.gray + '   ' + ver + c.reset);
    console.log('');
}

// ─── Help Screen ──────────────────────────────────────────────────────────────

function printHelp() {
    const cmds = [
        ['(no args)', 'Apply all patches (terminal, browser, file)'],
        ['--only TYPE', 'Patch only: terminal | browser | file'],
        ['--check', 'Check current patch status'],
        ['--revert', 'Restore original files'],
        ['--help', 'Show this help screen'],
    ];
    console.log(c.bold + c.white + '  USAGE' + c.reset);
    console.log(c.gray + '  ─────────────────────────────────────────────' + c.reset);
    console.log('  ' + c.cyan + 'npx antigravity-autopilot' + c.reset + c.gray + ' [option]' + c.reset + '\n');
    console.log(c.bold + c.white + '  OPTIONS' + c.reset);
    console.log(c.gray + '  ─────────────────────────────────────────────' + c.reset);
    for (const [flag, desc] of cmds) {
        console.log('  ' + c.yellow + c.bold + flag.padEnd(14) + c.reset + '  ' + c.white + desc + c.reset);
    }
    console.log('');
    console.log(c.bold + c.white + '  PATCH TYPES' + c.reset);
    console.log(c.gray + '  ─────────────────────────────────────────────' + c.reset);
    console.log('  ' + c.cyan + 'terminal' + c.reset + '      Auto-execute terminal commands');
    console.log('  ' + c.cyan + 'browser' + c.reset + '       Auto-confirm browser actions');
    console.log('  ' + c.cyan + 'file' + c.reset + '          Auto-allow file permissions');
    console.log('');
    console.log(c.bold + c.white + '  WORKFLOW' + c.reset);
    console.log(c.gray + '  ─────────────────────────────────────────────' + c.reset);
    console.log('  ' + c.green + '1.' + c.reset + ' Run ' + c.cyan + 'npx antigravity-autopilot' + c.reset + '  →  patch applied');
    console.log('  ' + c.green + '2.' + c.reset + ' Restart Antigravity                  →  AutoPilot active 🚀');
    console.log('  ' + c.green + '3.' + c.reset + ' Run ' + c.cyan + '--revert' + c.reset + '                    →  undo anytime');
    console.log('');
}

// ─── Section header ───────────────────────────────────────────────────────────

function section(title, icon) {
    const line = `${icon}  ${title}`;
    console.log(c.bold + c.white + line + c.reset);
    console.log(c.gray + '  ' + repeat('─', W - 2) + c.reset);
}

// ─── Installation Detection ───────────────────────────────────────────────────

function resolveFromBinary() {
    try {
        const { execFileSync } = require('child_process');
        const cmd = process.platform === 'win32' ? 'where' : 'which';
        const binPath = execFileSync(cmd, ['antigravity'], { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0].trim();
        if (!binPath) return null;
        const realBin = fs.realpathSync(binPath);
        // Binary is typically at <installDir>/bin/antigravity or <installDir>/antigravity
        let dir = path.dirname(realBin);
        // Walk up to find the directory containing 'resources/app'
        for (let i = 0; i < 5; i++) {
            const check = path.join(dir, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
            if (fs.existsSync(check)) return dir;
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    } catch { /* binary not in PATH or not installed */ }
    return null;
}

function findAntigravityPath() {
    const candidates = [];
    if (process.platform === 'win32') {
        candidates.push(
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity'),
            path.join(process.env.PROGRAMFILES || '', 'Antigravity'),
            path.join(process.env['PROGRAMFILES(X86)'] || '', 'Antigravity'),
        );
    } else if (process.platform === 'darwin') {
        candidates.push(
            '/Applications/Antigravity.app/Contents/Resources',
            path.join(os.homedir(), 'Applications', 'Antigravity.app', 'Contents', 'Resources'),
            // Homebrew cask installs
            '/opt/homebrew/Caskroom/antigravity',
        );
        // Dynamically scan Homebrew cask versions
        try {
            const caskDir = '/opt/homebrew/Caskroom/antigravity';
            if (fs.existsSync(caskDir)) {
                const versions = fs.readdirSync(caskDir).filter(v => v !== '.metadata');
                for (const v of versions) {
                    candidates.push(path.join(caskDir, v, 'Antigravity.app', 'Contents', 'Resources'));
                }
            }
        } catch { /* ignore */ }
    } else {
        candidates.push(
            '/usr/share/antigravity',
            '/usr/lib/antigravity',
            '/opt/antigravity',
            path.join(os.homedir(), '.local', 'share', 'antigravity'),
            // Snap install
            '/snap/antigravity/current',
            // Flatpak install
            '/var/lib/flatpak/app/com.antigravity.Antigravity/current/active/files',
            path.join(os.homedir(), '.local', 'share', 'flatpak', 'app', 'com.antigravity.Antigravity', 'current', 'active', 'files'),
        );
    }
    for (const c of candidates) {
        const f = path.join(c, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
        if (fs.existsSync(f)) return c;
    }
    // Fallback: resolve from the antigravity binary in PATH
    return resolveFromBinary();
}

function getTargetFiles(basePath) {
    return [
        { filePath: path.join(basePath, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js'), label: 'workbench' },
        { filePath: path.join(basePath, 'resources', 'app', 'out', 'jetskiAgent', 'main.js'), label: 'jetskiAgent' },
    ];
}

function getVersion(basePath) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(basePath, 'resources', 'app', 'package.json'), 'utf8'));
        const product = JSON.parse(fs.readFileSync(path.join(basePath, 'resources', 'app', 'product.json'), 'utf8'));
        return `${pkg.version} (IDE ${product.ideVersion})`;
    } catch { return 'unknown'; }
}

// ─── Analyze: Terminal Auto-Execute ───────────────────────────────────────────

function analyzeTerminal(content) {
    const onChangeRe = /(\w+)=(\w+)\((\w+)=>\{\w+\?\.setTerminalAutoExecutionPolicy\?\.\(\3\),\3===(\w+)\.EAGER\&\&(\w+)\(!0\)\},\[[\w,]*\]\)/;
    const onChangeMatch = content.match(onChangeRe);
    if (!onChangeMatch) return null;

    const [fullMatch, , callbackAlias, , enumAlias, confirmFn] = onChangeMatch;
    const matchIndex = content.indexOf(fullMatch);

    const policyRe = new RegExp(`(\\w+)=\\w+\\.terminalAutoExecutionPolicy\\?\\?${enumAlias}\\.OFF`);
    const policyMatch = content.substring(Math.max(0, matchIndex - 2000), matchIndex).match(policyRe);
    if (!policyMatch) return null;
    const policyVar = policyMatch[1];

    const secureRe = /(\w+)=\w+\?\.secureModeEnabled\?\?!1/;
    const secureMatch = content.substring(Math.max(0, matchIndex - 2000), matchIndex).match(secureRe);
    if (!secureMatch) return null;
    const secureVar = secureMatch[1];

    const nearbyCode = content.substring(Math.max(0, matchIndex - 5000), matchIndex + 5000);
    const effectCandidates = {};
    const effectRe = /\b(\w{2,3})\(()=>\{[^}]{3,80}\},\[/g;
    let m;
    while ((m = effectRe.exec(nearbyCode)) !== null) {
        const alias = m[1];
        if (alias !== callbackAlias && alias !== 'var' && alias !== 'new')
            effectCandidates[alias] = (effectCandidates[alias] || 0) + 1;
    }
    const cleanupRe = /\b(\w{2,3})\(()=>\{[^}]*return\s*()=>/g;
    while ((m = cleanupRe.exec(content)) !== null) {
        const alias = m[1];
        if (alias !== callbackAlias)
            effectCandidates[alias] = (effectCandidates[alias] || 0) + 5;
    }

    let useEffectAlias = null, maxCount = 0;
    for (const [alias, count] of Object.entries(effectCandidates)) {
        if (count > maxCount) { maxCount = count; useEffectAlias = alias; }
    }
    if (!useEffectAlias) return null;

    const patchCode = `_aep=${useEffectAlias}(()=>{${policyVar}===${enumAlias}.EAGER&&!${secureVar}&&${confirmFn}(!0)},[]),`;
    return {
        target: fullMatch,
        replacement: patchCode + fullMatch,
        patchMarker: `_aep=${useEffectAlias}(()=>{${policyVar}===${enumAlias}.EAGER`,
    };
}

// ─── Analyze: Browser Action Auto-Confirm ─────────────────────────────────────

function analyzeBrowser(content) {
    // Find the browserAction confirm:!0 callback pattern
    const confirmRe = /(\w+)=Mt\(\(\)=>\{(\w+)\(Ui\((\w+),\{trajectoryId:(\w+),stepIndex:(\w+),interaction:\{case:"browserAction",value:Ui\((\w+),\{confirm:!0\}\)\}\}\)\)\},\[([\w,]*)\]\)/;
    const confirmMatch = content.match(confirmRe);
    if (!confirmMatch) return null;

    const [fullMatch, confirmVar] = confirmMatch;
    const matchIndex = content.indexOf(fullMatch);

    // Find useEffect alias
    const nearbyCode = content.substring(Math.max(0, matchIndex - 5000), matchIndex + 5000);
    const effectCandidates = {};
    const effectRe = /\b(\w{2,3})\(\(\)=>\{[^}]{3,80}\},\[/g;
    let m;
    while ((m = effectRe.exec(nearbyCode)) !== null) {
        const alias = m[1];
        if (alias !== 'Mt' && alias !== 'Vi' && alias !== 'var' && alias !== 'new') {
            effectCandidates[alias] = (effectCandidates[alias] || 0) + 1;
        }
    }
    const cleanupRe = /\b(\w{2,3})\(\(\)=>\{[^}]*return\s*\(\)=>/g;
    while ((m = cleanupRe.exec(content)) !== null) {
        const alias = m[1];
        if (alias !== 'Mt' && alias !== 'Vi') {
            effectCandidates[alias] = (effectCandidates[alias] || 0) + 5;
        }
    }
    let useEffectAlias = null, maxCount = 0;
    for (const [alias, count] of Object.entries(effectCandidates)) {
        if (count > maxCount) { maxCount = count; useEffectAlias = alias; }
    }
    if (!useEffectAlias) return null;

    const patchCode = `_abp=${useEffectAlias}(()=>{${confirmVar}()},[${confirmVar}]),`;
    return {
        target: fullMatch,
        replacement: patchCode + fullMatch,
        patchMarker: `_abp=${useEffectAlias}(()=>{${confirmVar}()}`,
    };
}

// ─── Analyze: File Permission Auto-Allow ──────────────────────────────────────

function analyzeFile_(content) {
    // Find the filePermission sender pattern
    const senderRe = /(\w+)=\((\w+),(\w+)\)=>\{(\w+)\(Ui\((\w+),\{trajectoryId:(\w+),stepIndex:(\w+),interaction:\{case:"filePermission",value:Ui\((\w+),\{allow:\2,scope:\3,absolutePathUri:(\w+)\.absolutePathUri\}\)\}\}\)\)\}/;
    const senderMatch = content.match(senderRe);
    if (!senderMatch) return null;

    const [fullMatch, senderVar, , , , , , , , reqVar] = senderMatch;
    const matchIndex = content.indexOf(fullMatch);

    // Find scope enum — look for senderVar(!0, ENUM.CONVERSATION)
    const scopeRe = new RegExp(`${senderVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\(!0,(\\w+)\\.CONVERSATION\\)`);
    const scopeMatch = content.substring(matchIndex, matchIndex + 2000).match(scopeRe);
    if (!scopeMatch) return null;
    const scopeEnum = scopeMatch[1];

    // Find useEffect alias
    const nearbyCode = content.substring(Math.max(0, matchIndex - 5000), matchIndex + 5000);
    const effectCandidates = {};
    const effectRe = /\b(\w{2,3})\(\(\)=>\{[^}]{3,80}\},\[/g;
    let m2;
    while ((m2 = effectRe.exec(nearbyCode)) !== null) {
        const alias = m2[1];
        if (alias !== 'Mt' && alias !== 'Vi' && alias !== 'var' && alias !== 'new') {
            effectCandidates[alias] = (effectCandidates[alias] || 0) + 1;
        }
    }
    const cleanupRe = /\b(\w{2,3})\(\(\)=>\{[^}]*return\s*\(\)=>/g;
    while ((m2 = cleanupRe.exec(content)) !== null) {
        const alias = m2[1];
        if (alias !== 'Mt' && alias !== 'Vi') {
            effectCandidates[alias] = (effectCandidates[alias] || 0) + 5;
        }
    }
    let useEffectAlias = null, maxCount = 0;
    for (const [alias, count] of Object.entries(effectCandidates)) {
        if (count > maxCount) { maxCount = count; useEffectAlias = alias; }
    }
    if (!useEffectAlias) return null;

    const patchCode = `_afp=${useEffectAlias}(()=>{${senderVar}(!0,${scopeEnum}.CONVERSATION)},[${senderVar}]),`;
    return {
        target: fullMatch,
        replacement: patchCode + fullMatch,
        patchMarker: `_afp=${useEffectAlias}(()=>{${senderVar}(!0,${scopeEnum}.CONVERSATION)`,
    };
}

// ─── Patch Status Detection ───────────────────────────────────────────────────

const PATCH_TYPES = ['terminal', 'browser', 'file'];
const PATCH_LABELS = { terminal: 'Terminal auto-execute', browser: 'Browser auto-confirm', file: 'File auto-allow' };
const PATCH_MARKERS = {
    terminal: { includes: '_aep=', re: /_aep=\w+\(\(\)=>\{[^}]+EAGER/ },
    browser: { includes: '_abp=', re: /_abp=\w+\(\(\)=>\{\w+\(\)\}/ },
    file: { includes: '_afp=', re: /_afp=\w+\(\(\)=>\{\w+\(!0,/ },
};
const ANALYZERS = {
    terminal: analyzeTerminal,
    browser: analyzeBrowser,
    file: analyzeFile_,
};

function getPatchStatus(content) {
    const status = {};
    for (const type of PATCH_TYPES) {
        const m = PATCH_MARKERS[type];
        status[type] = content.includes(m.includes) && m.re.test(content);
    }
    return status;
}

// ─── Display Helpers ──────────────────────────────────────────────────────────

function row(icon, color, label, msg) {
    console.log('  ' + color + icon + c.reset + '  ' + c.bold + label.padEnd(14) + c.reset + c.gray + msg + c.reset);
}

function patchRow(icon, color, fileLabel, patchType, msg) {
    const combined = `[${fileLabel}]`;
    console.log('  ' + color + icon + c.reset + '  ' + c.bold + combined.padEnd(16) + c.reset + c.cyan + patchType.padEnd(10) + c.reset + c.gray + msg + c.reset);
}

// ─── File Operations ──────────────────────────────────────────────────────────

function patchFile(filePath, label, onlyTypes) {
    if (!fs.existsSync(filePath)) {
        row('⊘', c.gray, `[${label}]`, 'File not found — skipping');
        return true;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const status = getPatchStatus(content);
    const typesToPatch = onlyTypes || PATCH_TYPES;

    let patched = content;
    let anyNewPatch = false;
    let anyFailure = false;

    for (const type of typesToPatch) {
        if (status[type]) {
            patchRow('✔', c.green, label, type, 'Already patched — skipped');
            continue;
        }
        const analysis = ANALYZERS[type](patched);
        if (!analysis) {
            patchRow('⊘', c.yellow, label, type, 'Pattern not found — may be incompatible');
            // Not a hard failure — the pattern might not exist in this file
            continue;
        }
        const count = patched.split(analysis.target).length - 1;
        if (count !== 1) {
            patchRow('✖', c.red, label, type, `Target found ${count}× (expected 1)`);
            anyFailure = true;
            continue;
        }
        patched = patched.replace(analysis.target, analysis.replacement);
        anyNewPatch = true;
        patchRow('✔', c.green, label, type, 'Patched successfully');
    }

    if (anyNewPatch) {
        // Backup original (before any patching)
        const bak = filePath + '.bak';
        if (!fs.existsSync(bak)) {
            fs.copyFileSync(filePath, filePath + '.bak');
        }
        fs.writeFileSync(filePath, patched, 'utf8');
        const diff = fs.statSync(filePath).size - fs.statSync(filePath + '.bak').size;
        row('◈', c.blue, `[${label}]`, `Written (+${diff} bytes)`);
    }

    return !anyFailure;
}

function revertFile(filePath, label) {
    const bak = filePath + '.bak';
    if (!fs.existsSync(bak)) {
        row('⊘', c.gray, `[${label}]`, 'No backup found — skipping');
        return;
    }
    fs.copyFileSync(bak, filePath);
    row('✔', c.green, `[${label}]`, 'Restored from backup');
}

function checkFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
        row('⊘', c.gray, `[${label}]`, 'File not found');
        return false;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const status = getPatchStatus(content);
    const hasBak = fs.existsSync(filePath + '.bak');
    let allPatched = true;

    for (const type of PATCH_TYPES) {
        if (status[type]) {
            patchRow('✔', c.green, label, type, 'PATCHED' + (hasBak ? ' · backup exists' : ''));
        } else {
            const analysis = ANALYZERS[type](content);
            if (analysis) {
                patchRow('○', c.yellow, label, type, 'NOT PATCHED · patchable');
            } else {
                patchRow('⊘', c.gray, label, type, 'NOT PATCHED · pattern not found');
            }
            allPatched = false;
        }
    }
    return allPatched;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
    const args = process.argv.slice(2);
    const action = args.includes('--revert') ? 'revert'
        : args.includes('--check') ? 'check'
            : args.includes('--help') ? 'help'
                : 'apply';

    // Parse --only flag
    let onlyTypes = null;
    const onlyIdx = args.indexOf('--only');
    if (onlyIdx !== -1 && args[onlyIdx + 1]) {
        const requested = args[onlyIdx + 1].toLowerCase();
        if (!PATCH_TYPES.includes(requested)) {
            console.error(`Unknown patch type: ${requested}. Valid types: ${PATCH_TYPES.join(', ')}`);
            process.exit(1);
        }
        onlyTypes = [requested];
    }

    printBanner();

    if (action === 'help') { printHelp(); return; }

    // ── Locate Antigravity ──
    const basePath = findAntigravityPath();

    console.log('  ' + c.gray + '📍 Installation' + c.reset);
    if (!basePath) {
        console.log('  ' + c.red + c.bold + '✖  Antigravity not found.' + c.reset);
        console.log('     Install Antigravity from ' + c.cyan + 'https://antigravity.dev' + c.reset + ' first.\n');
        process.exit(1);
    }
    console.log('  ' + c.white + basePath + c.reset);
    console.log('  ' + c.gray + `Version: ${getVersion(basePath)}` + c.reset);
    console.log('');

    const files = getTargetFiles(basePath);

    // ── Action ──
    switch (action) {
        case 'check': {
            section('Status Check', '🔍');
            console.log('');
            files.forEach(f => checkFile(f.filePath, f.label));
            console.log('');
            const allPatched = files.every(f => {
                if (!fs.existsSync(f.filePath)) return true;
                const content = fs.readFileSync(f.filePath, 'utf8');
                const s = getPatchStatus(content);
                return s.terminal && s.browser && s.file;
            });
            if (allPatched) {
                console.log('  ' + c.green + c.bold + '✔  AutoPilot is ACTIVE on this machine.' + c.reset);
                console.log('  ' + c.gray + 'Restart Antigravity for changes to take effect.' + c.reset);
            } else {
                console.log('  ' + c.yellow + '  Run ' + c.cyan + 'npx antigravity-autopilot' + c.yellow + ' to activate AutoPilot.' + c.reset);
            }
            console.log('');
            break;
        }

        case 'revert': {
            section('Reverting Patch', '↩');
            console.log('');
            files.forEach(f => revertFile(f.filePath, f.label));
            console.log('');
            console.log('  ' + c.green + c.bold + '✔  Restored!' + c.reset + c.white + '  Restart Antigravity to apply changes.' + c.reset);
            console.log('');
            break;
        }

        case 'apply':
        default: {
            const typeLabel = onlyTypes ? onlyTypes.join(', ') : 'all';
            section(`Applying AutoPilot Patch (${typeLabel})`, '⚡');
            console.log('');
            const ok = files.every(f => patchFile(f.filePath, f.label, onlyTypes));
            console.log('');
            if (ok) {
                console.log('  +' + repeat('-', W - 2) + '+');
                console.log('  |' + pad(c.green + c.bold + '  OK  Patch applied successfully!' + c.reset, W - 2) + '|');
                console.log('  |' + pad(c.white + '     Restart Antigravity to activate AutoPilot.' + c.reset, W - 2) + '|');
                console.log('  |' + repeat(' ', W - 2) + '|');
                console.log('  |' + pad(c.gray + '  TIP Run with --revert to undo at any time.' + c.reset, W - 2) + '|');
                console.log('  |' + pad(c.gray + '  TIP Run with --check to see patch status.' + c.reset, W - 2) + '|');
                console.log('  |' + pad(c.gray + '  NOTE Re-run this command after Antigravity updates.' + c.reset, W - 2) + '|');
                console.log('  +' + repeat('-', W - 2) + '+');
            } else {
                console.log('  ' + c.red + c.bold + '✖  Some patches could not be applied.' + c.reset);
                console.log('  ' + c.gray + 'Check output above for details.' + c.reset);
                process.exit(1);
            }
            console.log('');
            break;
        }
    }
}

main();
