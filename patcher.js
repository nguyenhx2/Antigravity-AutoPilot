// patcher.js — runs in child_process.fork(), handles all heavy file I/O
// Ported directly from https://github.com/Kanezal/better-antigravity/blob/main/fixes/auto-run-fix/patch.js
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
            path.join(process.env['PROGRAMFILES(X86)'] || '', 'Antigravity'),
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
        {
            filePath: path.join(basePath, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js'),
            label: 'workbench',
        },
        {
            filePath: path.join(basePath, 'resources', 'app', 'out', 'jetskiAgent', 'main.js'),
            label: 'jetskiAgent',
        },
    ];
}

// ─── Smart Pattern Matching (ported from better-antigravity) ─────────────────

/**
 * Finds the onChange handler and extracts variable names, regardless of minification.
 * Port of: https://github.com/Kanezal/better-antigravity/blob/main/fixes/auto-run-fix/patch.js
 */
function analyzeFile(content, label) {
    const log = (msg) => process.send({ type: 'log', msg: `[AutoAccept] [${label}] ${msg}` });

    // 1. Find the onChange handler: contains setTerminalAutoExecutionPolicy AND .EAGER
    //    Pattern: VARNAME=CALLBACK(ARG=>{...setTerminalAutoExecutionPolicy...,ARG===ENUM.EAGER&&CONFIRM(!0)},[...])
    //    Exact regex from https://github.com/Kanezal/better-antigravity/blob/main/fixes/auto-run-fix/patch.js
    const onChangeRe = /(\w+)=(\w+)\((\w+)=>\{\w+\?\.setTerminalAutoExecutionPolicy\?\.\(\3\),\3===(\w+)\.EAGER&&(\w+)\(!0\)\},\[[\w,]*\]\)/;
    const onChangeMatch = content.match(onChangeRe);

    if (!onChangeMatch) {
        log('❌ Could not find onChange handler pattern');
        const idx = content.indexOf('setTerminalAutoExecutionPolicy');
        if (idx >= 0) {
            log(`  Context: ...${content.slice(Math.max(0, idx - 80), idx + 120)}...`);
        }
        return null;
    }

    const [fullMatch, assignVar, callbackAlias, argName, enumAlias, confirmFn] = onChangeMatch;
    const matchIndex = content.indexOf(fullMatch);

    log(`✓ Found onChange at offset ${matchIndex}`);
    log(`  callback=${callbackAlias}, enum=${enumAlias}, confirm=${confirmFn}`);

    // 2. Find policy variable: VARNAME=HANDLER?.terminalAutoExecutionPolicy??ENUM.OFF
    //    NOTE: must use ?\. (optional chaining) — this was the bug in previous version
    const policyRe = new RegExp(`(\\w+)=\\w+\\?\\.terminalAutoExecutionPolicy\\?\\?${enumAlias}\\.OFF`);
    const policyMatch = content.substring(Math.max(0, matchIndex - 2000), matchIndex).match(policyRe);

    if (!policyMatch) {
        log('❌ Could not find policy variable');
        return null;
    }
    const policyVar = policyMatch[1];
    log(`  policyVar=${policyVar}`);

    // 3. Find secureMode variable: VARNAME=HANDLER?.secureModeEnabled??!1
    const secureRe = /(\w+)=\w+\?\.secureModeEnabled\?\?!1/;
    const secureMatch = content.substring(Math.max(0, matchIndex - 2000), matchIndex).match(secureRe);

    if (!secureMatch) {
        log('❌ Could not find secureMode variable');
        return null;
    }
    const secureVar = secureMatch[1];
    log(`  secureVar=${secureVar}`);

    // 4. Find useEffect alias: look for ALIAS(()=>{...},[...]) calls nearby (not useCallback/useMemo)
    const nearbyCode = content.substring(Math.max(0, matchIndex - 5000), matchIndex + 5000);
    const effectCandidates = {};
    const effectRe = /\b(\w{2,3})\(\(\)=>\{[^}]{3,80}\},\[/g;
    let m;
    while ((m = effectRe.exec(nearbyCode)) !== null) {
        const alias = m[1];
        if (alias !== callbackAlias && alias !== 'var' && alias !== 'new') {
            effectCandidates[alias] = (effectCandidates[alias] || 0) + 1;
        }
    }

    // Also check broader file for common useEffect patterns (with cleanup return)
    const cleanupRe = /\b(\w{2,3})\(\(\)=>\{[^}]*return\s*\(\)=>/g;
    while ((m = cleanupRe.exec(content)) !== null) {
        const alias = m[1];
        if (alias !== callbackAlias) {
            effectCandidates[alias] = (effectCandidates[alias] || 0) + 5; // higher weight
        }
    }

    // Pick the most common candidate
    let useEffectAlias = null;
    let maxCount = 0;
    for (const [alias, count] of Object.entries(effectCandidates)) {
        if (count > maxCount) {
            maxCount = count;
            useEffectAlias = alias;
        }
    }

    if (!useEffectAlias) {
        log('❌ Could not determine useEffect alias');
        return null;
    }
    log(`  useEffect=${useEffectAlias} (confidence: ${maxCount} hits)`);

    // 5. Build patch — exact same logic as original
    const patchCode = `_aep=${useEffectAlias}(()=>{${policyVar}===${enumAlias}.EAGER&&!${secureVar}&&${confirmFn}(!0)},[]),`;

    return {
        target: fullMatch,
        replacement: patchCode + fullMatch,
        patchMarker: `_aep=${useEffectAlias}(()=>{${policyVar}===${enumAlias}.EAGER`,
        label
    };
}

// ─── File Operations ─────────────────────────────────────────────────────────

function isFilePatched(filePath) {
    if (!fs.existsSync(filePath)) return false;
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.includes('_aep=') && /_aep=\w+\(\(\)=>\{[^}]+EAGER/.test(content);
    } catch {
        return false;
    }
}

function patchFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
        process.send({ type: 'log', msg: `[AutoAccept] ⏭️  [${label}] File not found, skipping` });
        return true; // optional file missing is not a failure
    }

    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        process.send({ type: 'log', msg: `[AutoAccept] ❌ [${label}] Read error: ${e.message}` });
        return false;
    }

    if (isFilePatched(filePath)) {
        process.send({ type: 'log', msg: `[AutoAccept] ⏭️  [${label}] Already patched` });
        return true;
    }

    const analysis = analyzeFile(content, label);
    if (!analysis) return false;

    // Verify target uniqueness
    const count = content.split(analysis.target).length - 1;
    if (count !== 1) {
        process.send({ type: 'log', msg: `[AutoAccept] ❌ [${label}] Target found ${count}x (expected 1)` });
        return false;
    }

    // Backup original
    const bakPath = filePath + '.bak';
    if (!fs.existsSync(bakPath)) {
        fs.copyFileSync(filePath, bakPath);
        process.send({ type: 'log', msg: `[AutoAccept] 📦 [${label}] Backup created` });
    }

    const patched = content.replace(analysis.target, analysis.replacement);
    fs.writeFileSync(filePath, patched, 'utf8');

    const sizeDiff = fs.statSync(filePath).size - fs.statSync(bakPath).size;
    process.send({ type: 'log', msg: `[AutoAccept] ✅ [${label}] Patched (+${sizeDiff} bytes)` });
    return true;
}

function revertFile(filePath, label) {
    const bak = filePath + '.bak';
    if (!fs.existsSync(bak)) {
        process.send({ type: 'log', msg: `[AutoAccept] ⏭️  [${label}] No backup, skipping` });
        return;
    }
    fs.copyFileSync(bak, filePath);
    process.send({ type: 'log', msg: `[AutoAccept] ✅ [${label}] Reverted` });
}

// ─── Message Handler ──────────────────────────────────────────────────────────

process.on('message', (msg) => {
    const basePath = findAntigravityPath();

    if (msg.command === 'status') {
        if (!basePath) {
            process.send({ type: 'status', basePath: null, files: [] });
            process.exit(0);
            return;
        }
        const files = getTargetFiles(basePath).map(f => ({
            label: f.label,
            patched: isFilePatched(f.filePath),
            exists: fs.existsSync(f.filePath),
        }));
        process.send({ type: 'status', basePath, files });
        process.exit(0);

    } else if (msg.command === 'apply') {
        if (!basePath) {
            process.send({ type: 'result', success: false, message: '❌ Antigravity không tìm thấy! Hãy đảm bảo đã cài đặt.' });
            process.exit(1);
            return;
        }
        const targets = getTargetFiles(basePath);
        const results = targets.map(f => patchFile(f.filePath, f.label));
        const success = results.every(Boolean);
        process.send({
            type: 'result',
            success,
            message: success
                ? '✅ Patch thành công! Restart Antigravity để áp dụng.'
                : '⚠️ Một số file không patch được. Xem Output > AutoAccept để biết chi tiết.',
        });
        process.exit(success ? 0 : 1);

    } else if (msg.command === 'revert') {
        if (!basePath) {
            process.send({ type: 'result', success: false, message: '❌ Antigravity không tìm thấy!' });
            process.exit(1);
            return;
        }
        getTargetFiles(basePath).forEach(f => revertFile(f.filePath, f.label));
        process.send({ type: 'result', success: true, message: '✅ Đã hoàn tác! Restart Antigravity để áp dụng.' });
        process.exit(0);
    }
});
