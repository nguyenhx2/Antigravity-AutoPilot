// patcher.js — runs in child_process.fork(), handles all heavy file I/O
// Ported directly from https://github.com/Kanezal/better-antigravity/blob/main/fixes/auto-run-fix/patch.js
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Installation Detection ──────────────────────────────────────────────────

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
    const log = (msg) => process.send({ type: 'log', msg: `[AutoPilot] [${label}] ${msg}` });

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

// ─── Browser Action Permission (auto-confirm) ───────────────────────────────

/**
 * Finds the JPc browser-action confirmation component and builds auto-confirm patch.
 * Pattern: COMP=({sourceTrajectoryStepInfo:VAR,...,url:VAR})=>{...CONFIRM_FN=Mt(()=>{SEND(Ui(MSG,{...,interaction:{case:"browserAction",value:Ui(TYPE,{confirm:!0})}}))},...)...}
 */
function analyzeBrowserAction(content, label) {
    const log = (msg) => process.send({ type: 'log', msg: `[AutoPilot] [${label}] [browser] ${msg}` });

    // 1. Find the browserAction confirm:!0 callback pattern
    //    VAR=Mt(()=>{SEND(Ui(MSG,{trajectoryId:VAR,stepIndex:VAR,interaction:{case:"browserAction",value:Ui(TYPE,{confirm:!0})}}))},DEPS)
    const confirmRe = /(\w+)=Mt\(\(\)=>\{(\w+)\(Ui\((\w+),\{trajectoryId:(\w+),stepIndex:(\w+),interaction:\{case:"browserAction",value:Ui\((\w+),\{confirm:!0\}\)\}\}\)\)\},\[([\w,]*)\]\)/;
    const confirmMatch = content.match(confirmRe);

    if (!confirmMatch) {
        log('❌ Could not find browserAction confirm pattern');
        const idx = content.indexOf('browserAction');
        if (idx >= 0) {
            log(`  Context: ...${content.slice(Math.max(0, idx - 80), idx + 120)}...`);
        }
        return null;
    }

    const [fullMatch, confirmVar] = confirmMatch;
    const matchIndex = content.indexOf(fullMatch);
    log(`✓ Found browserAction confirm at offset ${matchIndex}`);
    log(`  confirmVar=${confirmVar}`);

    // 2. Find useEffect alias (reuse from nearby code)
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

    // 3. Build patch — auto-call confirmVar() on mount
    const patchCode = `_abp=${useEffectAlias}(()=>{${confirmVar}()},[${confirmVar}]),`;

    return {
        target: fullMatch,
        replacement: patchCode + fullMatch,
        patchMarker: `_abp=${useEffectAlias}(()=>{${confirmVar}()}`,
        label
    };
}

// ─── File Access Permission (auto-allow with conversation scope) ─────────────

/**
 * Finds the rBe file-permission component and builds auto-allow patch.
 * Pattern: COMP=({sourceTrajectoryStepInfo:VAR,req:VAR,status:VAR})=>{...SEND_FN...filePermission...scope...}
 */
function analyzeFilePermission(content, label) {
    const log = (msg) => process.send({ type: 'log', msg: `[AutoPilot] [${label}] [file] ${msg}` });

    // 1. Find the filePermission sender pattern
    //    VAR=(ALLOW_VAR,SCOPE_VAR)=>{SEND(Ui(MSG,{trajectoryId:VAR,stepIndex:VAR,interaction:{case:"filePermission",value:Ui(TYPE,{allow:ALLOW_VAR,scope:SCOPE_VAR,absolutePathUri:REQ.absolutePathUri})}}))};
    const senderRe = /(\w+)=\((\w+),(\w+)\)=>\{(\w+)\(Ui\((\w+),\{trajectoryId:(\w+),stepIndex:(\w+),interaction:\{case:"filePermission",value:Ui\((\w+),\{allow:\2,scope:\3,absolutePathUri:(\w+)\.absolutePathUri\}\)\}\}\)\)\}/;
    const senderMatch = content.match(senderRe);

    if (!senderMatch) {
        log('❌ Could not find filePermission sender pattern');
        const idx = content.indexOf('filePermission');
        if (idx >= 0) {
            log(`  Context: ...${content.slice(Math.max(0, idx - 80), idx + 120)}...`);
        }
        return null;
    }

    const [fullMatch, senderVar, , , , , , , , reqVar] = senderMatch;
    const matchIndex = content.indexOf(fullMatch);
    log(`✓ Found filePermission sender at offset ${matchIndex}`);
    log(`  senderVar=${senderVar}, reqVar=${reqVar}`);

    // 2. Find the scope enum (kot) — look for kot.CONVERSATION or similar near filePermission
    //    Pattern: o(!0,ENUM.CONVERSATION) in the Allow This Conversation button
    const scopeRe = new RegExp(`${senderVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\(!0,(\w+)\.CONVERSATION\)`);
    const scopeMatch = content.substring(matchIndex, matchIndex + 2000).match(scopeRe);

    if (!scopeMatch) {
        log('❌ Could not find scope enum (CONVERSATION)');
        return null;
    }
    const scopeEnum = scopeMatch[1];
    log(`  scopeEnum=${scopeEnum}`);

    // 3. Find useEffect alias
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

    // 4. Build patch — auto-call senderVar(!0, scopeEnum.CONVERSATION) on mount
    const patchCode = `_afp=${useEffectAlias}(()=>{${senderVar}(!0,${scopeEnum}.CONVERSATION)},[${senderVar}]),`;

    return {
        target: fullMatch,
        replacement: patchCode + fullMatch,
        patchMarker: `_afp=${useEffectAlias}(()=>{${senderVar}(!0,${scopeEnum}.CONVERSATION)`,
        label
    };
}

// ─── File Operations ─────────────────────────────────────────────────────────

function isFilePatched(filePath) {
    if (!fs.existsSync(filePath)) return false;
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const hasTerminal = content.includes('_aep=') && /_aep=\w+\(\(\)=>\{[^}]+EAGER/.test(content);
        const hasBrowser = content.includes('_abp=') && /_abp=\w+\(\(\)=>\{\w+\(\)\}/.test(content);
        const hasFile = content.includes('_afp=') && /_afp=\w+\(\(\)=>\{\w+\(!0,/.test(content);
        return hasTerminal || hasBrowser || hasFile;
    } catch {
        return false;
    }
}

function patchFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
        process.send({ type: 'log', msg: `[AutoPilot] ⏭️  [${label}] File not found, skipping` });
        return true; // optional file missing is not a failure
    }

    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        process.send({ type: 'log', msg: `[AutoPilot] ❌ [${label}] Read error: ${e.message}` });
        return false;
    }

    // Backup original (before any patching)
    const bakPath = filePath + '.bak';
    if (!fs.existsSync(bakPath)) {
        fs.copyFileSync(filePath, bakPath);
        process.send({ type: 'log', msg: `[AutoPilot] 📦 [${label}] Backup created` });
    }

    let patched = content;
    let anyPatched = false;

    // ── Terminal auto-execute patch ──
    if (!content.includes('_aep=')) {
        const analysis = analyzeFile(content, label);
        if (analysis) {
            const count = patched.split(analysis.target).length - 1;
            if (count === 1) {
                patched = patched.replace(analysis.target, analysis.replacement);
                anyPatched = true;
                process.send({ type: 'log', msg: `[AutoPilot] ✅ [${label}] Terminal auto-execute patched` });
            } else {
                process.send({ type: 'log', msg: `[AutoPilot] ⚠️ [${label}] Terminal target found ${count}x (expected 1)` });
            }
        }
    } else {
        process.send({ type: 'log', msg: `[AutoPilot] ⏭️  [${label}] Terminal already patched` });
    }

    // ── Browser action auto-confirm patch ──
    if (!patched.includes('_abp=')) {
        const browserAnalysis = analyzeBrowserAction(patched, label);
        if (browserAnalysis) {
            const count = patched.split(browserAnalysis.target).length - 1;
            if (count === 1) {
                patched = patched.replace(browserAnalysis.target, browserAnalysis.replacement);
                anyPatched = true;
                process.send({ type: 'log', msg: `[AutoPilot] ✅ [${label}] Browser action auto-confirm patched` });
            } else {
                process.send({ type: 'log', msg: `[AutoPilot] ⚠️ [${label}] Browser target found ${count}x (expected 1)` });
            }
        }
    } else {
        process.send({ type: 'log', msg: `[AutoPilot] ⏭️  [${label}] Browser action already patched` });
    }

    // ── File permission auto-allow patch ──
    if (!patched.includes('_afp=')) {
        const fileAnalysis = analyzeFilePermission(patched, label);
        if (fileAnalysis) {
            const count = patched.split(fileAnalysis.target).length - 1;
            if (count === 1) {
                patched = patched.replace(fileAnalysis.target, fileAnalysis.replacement);
                anyPatched = true;
                process.send({ type: 'log', msg: `[AutoPilot] ✅ [${label}] File permission auto-allow patched` });
            } else {
                process.send({ type: 'log', msg: `[AutoPilot] ⚠️ [${label}] File target found ${count}x (expected 1)` });
            }
        }
    } else {
        process.send({ type: 'log', msg: `[AutoPilot] ⏭️  [${label}] File permission already patched` });
    }

    if (anyPatched) {
        fs.writeFileSync(filePath, patched, 'utf8');
        const sizeDiff = fs.statSync(filePath).size - fs.statSync(bakPath).size;
        process.send({ type: 'log', msg: `[AutoPilot] ✅ [${label}] All patches applied (+${sizeDiff} bytes)` });
    } else if (!content.includes('_aep=') && !content.includes('_abp=') && !content.includes('_afp=')) {
        process.send({ type: 'log', msg: `[AutoPilot] ❌ [${label}] No patches could be applied` });
        return false;
    } else {
        process.send({ type: 'log', msg: `[AutoPilot] ⏭️  [${label}] All patches already applied` });
    }
    return true;
}

function revertFile(filePath, label) {
    const bak = filePath + '.bak';
    if (!fs.existsSync(bak)) {
        process.send({ type: 'log', msg: `[AutoPilot] ⏭️  [${label}] No backup, skipping` });
        return;
    }
    fs.copyFileSync(bak, filePath);
    process.send({ type: 'log', msg: `[AutoPilot] ✅ [${label}] Reverted` });
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
        const files = getTargetFiles(basePath).map(f => {
            let patchDetails = { terminal: false, browser: false, file: false };
            if (fs.existsSync(f.filePath)) {
                try {
                    const fc = fs.readFileSync(f.filePath, 'utf8');
                    patchDetails.terminal = fc.includes('_aep=') && /_aep=\w+\(\(\)=>\{[^}]+EAGER/.test(fc);
                    patchDetails.browser = fc.includes('_abp=') && /_abp=\w+\(\(\)=>\{\w+\(\)\}/.test(fc);
                    patchDetails.file = fc.includes('_afp=') && /_afp=\w+\(\(\)=>\{\w+\(!0,/.test(fc);
                } catch { }
            }
            return {
                label: f.label,
                patched: patchDetails.terminal || patchDetails.browser || patchDetails.file,
                patchDetails,
                exists: fs.existsSync(f.filePath),
            };
        });
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
                : '⚠️ Một số file không patch được. Xem Output > AutoPilot để biết chi tiết.',
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
