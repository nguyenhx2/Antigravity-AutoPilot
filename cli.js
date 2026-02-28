#!/usr/bin/env node

/**
 * Antigravity AutoPilot — CLI
 * ============================
 * Patches Antigravity's runtime JS bundle so that the
 * "Always Proceed" terminal execution policy actually
 * auto-executes commands without manual confirmation.
 *
 * Usage:
 *   npx antigravity-autopilot           Apply patch
 *   npx antigravity-autopilot --check   Check patch status
 *   npx antigravity-autopilot --revert  Restore original files
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Installation Detection ──────────────────────────────────────────────────

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

// ─── Core Patch Logic (regex-based, version-agnostic) ───────────────────────

function analyzeFile(content, label) {
    // 1. Find the onChange handler for setTerminalAutoExecutionPolicy
    const onChangeRe = /(\w+)=(\w+)\((\w+)=>\{\w+\?\.setTerminalAutoExecutionPolicy\?\.\(\3\),\3===(\w+)\.EAGER&&(\w+)\(!0\)\},\[[\w,]*\]\)/;
    const onChangeMatch = content.match(onChangeRe);
    if (!onChangeMatch) {
        console.log(`  ❌ [${label}] Could not find onChange handler pattern`);
        return null;
    }

    const [fullMatch, , callbackAlias, , enumAlias, confirmFn] = onChangeMatch;
    const matchIndex = content.indexOf(fullMatch);
    console.log(`  📋 [${label}] Found onChange at offset ${matchIndex}`);
    console.log(`     callback=${callbackAlias}, enum=${enumAlias}, confirm=${confirmFn}`);

    // 2. Find policy variable: VAR=HANDLER?.terminalAutoExecutionPolicy??ENUM.OFF
    const policyRe = new RegExp(`(\\w+)=\\w+\\?\\.terminalAutoExecutionPolicy\\?\\?${enumAlias}\\.OFF`);
    const policyMatch = content.substring(Math.max(0, matchIndex - 2000), matchIndex).match(policyRe);
    if (!policyMatch) { console.log(`  ❌ [${label}] Could not find policy variable`); return null; }
    const policyVar = policyMatch[1];
    console.log(`     policyVar=${policyVar}`);

    // 3. Find secureMode variable: VAR=HANDLER?.secureModeEnabled??!1
    const secureRe = /(\w+)=\w+\?\.secureModeEnabled\?\?!1/;
    const secureMatch = content.substring(Math.max(0, matchIndex - 2000), matchIndex).match(secureRe);
    if (!secureMatch) { console.log(`  ❌ [${label}] Could not find secureMode variable`); return null; }
    const secureVar = secureMatch[1];
    console.log(`     secureVar=${secureVar}`);

    // 4. Find useEffect alias via frequency counting
    const nearbyCode = content.substring(Math.max(0, matchIndex - 5000), matchIndex + 5000);
    const effectCandidates = {};
    const effectRe = /\b(\w{2,3})\(\(\)=>\{[^}]{3,80}\},\[/g;
    let m;
    while ((m = effectRe.exec(nearbyCode)) !== null) {
        const alias = m[1];
        if (alias !== callbackAlias && alias !== 'var' && alias !== 'new')
            effectCandidates[alias] = (effectCandidates[alias] || 0) + 1;
    }
    const cleanupRe = /\b(\w{2,3})\(\(\)=>\{[^}]*return\s*\(\)=>/g;
    while ((m = cleanupRe.exec(content)) !== null) {
        const alias = m[1];
        if (alias !== callbackAlias)
            effectCandidates[alias] = (effectCandidates[alias] || 0) + 5;
    }

    let useEffectAlias = null, maxCount = 0;
    for (const [alias, count] of Object.entries(effectCandidates)) {
        if (count > maxCount) { maxCount = count; useEffectAlias = alias; }
    }
    if (!useEffectAlias) { console.log(`  ❌ [${label}] Could not determine useEffect alias`); return null; }
    console.log(`     useEffect=${useEffectAlias} (confidence: ${maxCount} hits)`);

    // 5. Build patch
    const patchCode = `_aep=${useEffectAlias}(()=>{${policyVar}===${enumAlias}.EAGER&&!${secureVar}&&${confirmFn}(!0)},[]),`;
    return {
        target: fullMatch,
        replacement: patchCode + fullMatch,
        patchMarker: `_aep=${useEffectAlias}(()=>{${policyVar}===${enumAlias}.EAGER`,
    };
}

// ─── File Operations ─────────────────────────────────────────────────────────

function isPatched(filePath) {
    if (!fs.existsSync(filePath)) return false;
    const c = fs.readFileSync(filePath, 'utf8');
    return c.includes('_aep=') && /_aep=\w+\(\(\)=>\{[^}]+EAGER/.test(c);
}

function patchFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
        console.log(`  ⏭️  [${label}] Not found, skipping`);
        return true;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    if (isPatched(filePath)) {
        console.log(`  ⏭️  [${label}] Already patched`);
        return true;
    }
    const analysis = analyzeFile(content, label);
    if (!analysis) return false;

    const count = content.split(analysis.target).length - 1;
    if (count !== 1) { console.log(`  ❌ [${label}] Target found ${count}x (expected 1)`); return false; }

    const bak = filePath + '.bak';
    if (!fs.existsSync(bak)) { fs.copyFileSync(filePath, bak); console.log(`  📦 [${label}] Backup created`); }

    fs.writeFileSync(filePath, content.replace(analysis.target, analysis.replacement), 'utf8');
    const diff = fs.statSync(filePath).size - fs.statSync(bak).size;
    console.log(`  ✅ [${label}] Patched (+${diff} bytes)`);
    return true;
}

function revertFile(filePath, label) {
    const bak = filePath + '.bak';
    if (!fs.existsSync(bak)) { console.log(`  ⏭️  [${label}] No backup, skipping`); return; }
    fs.copyFileSync(bak, filePath);
    console.log(`  ✅ [${label}] Restored`);
}

function checkFile(filePath, label) {
    if (!fs.existsSync(filePath)) { console.log(`  ❌ [${label}] Not found`); return false; }
    const content = fs.readFileSync(filePath, 'utf8');
    const patched = isPatched(filePath);
    const hasBak = fs.existsSync(filePath + '.bak');
    if (patched) {
        console.log(`  ✅ [${label}] PATCHED` + (hasBak ? ' (backup exists)' : ''));
    } else {
        const analysis = analyzeFile(content, label);
        console.log(analysis ? `  ⬜ [${label}] NOT PATCHED (patchable)` : `  ⚠️  [${label}] NOT PATCHED (may be incompatible)`);
    }
    return patched;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
    const args = process.argv.slice(2);
    const action = args.includes('--revert') ? 'revert' : args.includes('--check') ? 'check' : 'apply';

    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║    ⚡  Antigravity AutoPilot            ║');
    console.log('╚══════════════════════════════════════════╝');

    const basePath = findAntigravityPath();
    if (!basePath) {
        console.log('\n❌ Antigravity not found. Make sure it is installed.\n');
        process.exit(1);
    }

    console.log(`\n📍 ${basePath}`);
    console.log(`📦 Antigravity version: ${getVersion(basePath)}\n`);

    const files = getTargetFiles(basePath);

    switch (action) {
        case 'check':
            console.log('🔍 Checking patch status...\n');
            files.forEach(f => checkFile(f.filePath, f.label));
            break;

        case 'revert':
            console.log('↩️  Reverting patch...\n');
            files.forEach(f => revertFile(f.filePath, f.label));
            console.log('\n✨ Restored! Restart Antigravity to apply changes.');
            break;

        case 'apply':
        default:
            console.log('🚀 Applying autopilot patch...\n');
            const ok = files.every(f => patchFile(f.filePath, f.label));
            if (ok) {
                console.log('\n✨ Done! Restart Antigravity to activate AutoPilot.');
                console.log('💡 Run with --revert to undo.');
                console.log('⚠️  Re-run after Antigravity updates.\n');
            } else {
                console.log('\n⚠️  Some files could not be patched. Check output above.\n');
                process.exit(1);
            }
            break;
    }
}

main();
