# Release Checklist — Antigravity AutoPilot

Follow these steps **in order** for every release.
All platforms (npm, VSIX, GitHub Release) must have the **same version**.

## Pre-Release

1. **Update code** — implement features/fixes
2. **Bump `version`** in `package.json` ← single source of truth for all platforms
3. **Update `README.md`** — document new features, commands, flags
4. **Update `--help` screen** in `cli.js` if CLI changed
5. **Update extension VSIX version reference** in `README.md` install command
6. **Update `cli.js` banner version** if it has inline version strings

## Build & Test

7. **Build VSIX:**
   ```bash
   npx -y @vscode/vsce package --no-dependencies
   ```
8. **Install VSIX locally:**
   ```bash
   cursor --install-extension antigravity-autopilot-X.Y.Z.vsix --force
   ```
9. **Test CLI commands:**
   ```bash
   node cli.js --check        # verify per-patch status display
   node cli.js                # apply patches, check graceful skip
   node cli.js                # double-apply: all should show "Already patched"
   node cli.js --revert       # revert
   node cli.js --only terminal   # selective patch
   node cli.js --help         # verify help screen
   ```

## Publish (order matters!)

10. **Commit all changes (including README, RELEASE.md, etc.):**
    ```bash
    git add -A && git commit -m "feat: description (vX.Y.Z)"
    ```
11. **Push to GitHub:**
    ```bash
    git push origin master
    ```
12. **Publish to npm** (README is frozen at this point!):
    ```bash
    npm publish
    ```
13. **Create annotated tag** (triggers GitHub Release workflow):
    ```bash
    git tag -a vX.Y.Z -m "vX.Y.Z - changelog summary"
    git push origin vX.Y.Z
    ```

## Post-Release Verification

14. **Verify npm:**
    ```bash
    npm info antigravity-autopilot version   # should show X.Y.Z
    ```
15. **Verify npm README** — visit https://www.npmjs.com/package/antigravity-autopilot
16. **Verify GitHub Release** — check that the workflow ran and VSIX is attached
17. **(Optional) Publish to VS Code Marketplace:**
    ```bash
    npx -y @vscode/vsce publish
    ```

## Version Sync Matrix

All of these must show the **same version**:

| Location | File | What to update |
|----------|------|---------------|
| npm | `package.json` → `version` | Primary source of truth |
| CLI banner | `cli.js` → `VERSION` constant | Reads from `package.json` automatically |
| VSIX | Built from `package.json` version | Rebuild after version bump |
| README | VSIX install command filename | Update `antigravity-autopilot-X.Y.Z.vsix` |
| GitHub Release | Tag name `vX.Y.Z` | Must match `package.json` version |

## Common Mistakes to Avoid

- ❌ Publishing to npm **before** updating README (npm freezes README at publish time)
- ❌ Forgetting to rebuild VSIX after version bump
- ❌ Forgetting to update VSIX filename in README
- ❌ Different versions across npm / VSIX / GitHub tag
- ❌ Using wrong branch name (`master` vs `main`)
- ❌ Wrong publisher ID in `package.json` for Marketplace
