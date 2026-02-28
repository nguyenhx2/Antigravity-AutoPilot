#!/usr/bin/env node

/**
 * Antigravity AutoPilot — CLI v1.3.0
 * ====================================
 *   npx antigravity-autopilot           Apply patch
 *   npx antigravity-autopilot --check   Check status
 *   npx antigravity-autopilot --revert  Restore originals
 *   npx antigravity-autopilot --help    Show help
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
        ['(no args)', 'Apply the AutoPilot patch'],
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
        console.log('  ' + c.yellow + c.bold + flag.padEnd(12) + c.reset + '  ' + c.white + desc + c.reset);
    }
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

function findAntigravityPath() {
    const candidates = [];
    if (process.platform === 'win32') {
        candidates.push(
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity'),
            path.join(process.env.PROGRAMFILES || '', 'Antigravity'),
        );
    } else if (process.platform === 'darwin') {
        candidates.push(
            '/Applications/Antigravity.app/Contents/Resources',
            path.join(os.homedir(), 'Applications', 'Antigravity.app', 'Contents', 'Resources'),
        );
    } else {
        candidates.push(
            '/usr/share/antigravity',
            '/opt/antigravity',
            path.join(os.homedir(), '.local', 'share', 'antigravity'),
        );
    }
    for (const c of candidates) {
        const f = path.join(c, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
        if (fs.existsSync(f)) return c;
    }
    return null;
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

// ─── Core Patch Logic ─────────────────────────────────────────────────────────

function analyzeFile(content, label) {
    const onChangeRe = /(\w+)=(\w+)\((\w+)=>\{\w+\?\.setTerminalAutoExecutionPolicy\?\.\(\3\),\3===(\w+)\.EAGER\&\&(\w+)\(!0\)\},\[[\w,]*\]\)/;
    const onChangeMatch = content.match(onChangeRe);
    if (!onChangeMatch) { return null; }

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

// ─── File Operations ──────────────────────────────────────────────────────────

function isPatched(filePath) {
    if (!fs.existsSync(filePath)) return false;
    const c = fs.readFileSync(filePath, 'utf8');
    return c.includes('_aep=') && /_aep=\w+\(()=>\{[^}]+EAGER/.test(c);
}

function row(icon, color, label, msg) {
    console.log('  ' + color + icon + c.reset + '  ' + c.bold + label.padEnd(14) + c.reset + c.gray + msg + c.reset);
}

function patchFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
        row('⊘', c.gray, `[${label}]`, 'File not found — skipping');
        return true;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    if (isPatched(filePath)) {
        row('✔', c.green, `[${label}]`, 'Already patched');
        return true;
    }
    const analysis = analyzeFile(content, label);
    if (!analysis) {
        row('✖', c.red, `[${label}]`, 'Pattern not found — may be incompatible version');
        return false;
    }

    const count = content.split(analysis.target).length - 1;
    if (count !== 1) {
        row('✖', c.red, `[${label}]`, `Target found ${count}× (expected 1)`);
        return false;
    }

    const bak = filePath + '.bak';
    if (!fs.existsSync(bak)) {
        fs.copyFileSync(filePath, bak);
        row('◈', c.blue, `[${label}]`, 'Backup created (.bak)');
    }

    fs.writeFileSync(filePath, content.replace(analysis.target, analysis.replacement), 'utf8');
    const diff = fs.statSync(filePath).size - fs.statSync(bak).size;
    row('✔', c.green, `[${label}]`, `Patched successfully (+${diff} bytes)`);
    return true;
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
        row('✖', c.red, `[${label}]`, 'File not found');
        return false;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const patched = isPatched(filePath);
    const hasBak = fs.existsSync(filePath + '.bak');
    const analysis = !patched ? analyzeFile(content, label) : null;

    if (patched) {
        row('✔', c.green, `[${label}]`, 'PATCHED' + (hasBak ? ' · backup exists' : ''));
    } else if (analysis) {
        row('○', c.yellow, `[${label}]`, 'NOT PATCHED · patchable, ready to apply');
    } else {
        row('⚠', c.yellow, `[${label}]`, 'NOT PATCHED · may be incompatible');
    }
    return patched;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
    const args = process.argv.slice(2);
    const action = args.includes('--revert') ? 'revert'
        : args.includes('--check') ? 'check'
            : args.includes('--help') ? 'help'
                : 'apply';

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
            const allPatched = files.every(f => isPatched(f.filePath));
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
            section('Applying AutoPilot Patch', '⚡');
            console.log('');
            const ok = files.every(f => patchFile(f.filePath, f.label));
            console.log('');
            if (ok) {
                console.log('  +' + repeat('-', W - 2) + '+');
                console.log('  |' + pad(c.green + c.bold + '  OK  Patch applied successfully!' + c.reset, W - 2) + '|');
                console.log('  |' + pad(c.white + '     Restart Antigravity to activate AutoPilot.' + c.reset, W - 2) + '|');
                console.log('  |' + repeat(' ', W - 2) + '|');
                console.log('  |' + pad(c.gray + '  TIP Run with --revert to undo at any time.' + c.reset, W - 2) + '|');
                console.log('  |' + pad(c.gray + '  NOTE Re-run this command after Antigravity updates.' + c.reset, W - 2) + '|');
                console.log('  +' + repeat('-', W - 2) + '+');
            } else {
                console.log('  ' + c.red + c.bold + '✖  Some files could not be patched.' + c.reset);
                console.log('  ' + c.gray + 'Check output above for details.' + c.reset);
                process.exit(1);
            }
            console.log('');
            break;
        }
    }
}

main();
