# Release Checklist — Antigravity AutoPilot

Follow these steps in order for every release.

## Pre-Release

1. **Update code** — implement features/fixes
2. **Bump `version`** in `package.json`
3. **Update `README.md`** — document new features, commands, flags
4. **Update `--help` screen** in `cli.js` if CLI changed
5. **Update extension VSIX version reference** in `README.md` install command

## Build & Test

6. **Build VSIX:**
   ```bash
   npx -y @vscode/vsce package --no-dependencies
   ```
7. **Install VSIX locally:**
   ```bash
   cursor --install-extension antigravity-autopilot-X.Y.Z.vsix --force
   ```
8. **Test CLI commands:**
   ```bash
   node cli.js --check     # verify per-patch status display
   node cli.js             # apply patches, check graceful skip
   node cli.js             # double-apply: all should show "Already patched"
   node cli.js --revert    # revert, then re-apply
   node cli.js --only terminal  # selective patch
   node cli.js --help      # verify help screen
   ```

## Publish

9. **Commit all changes:**
   ```bash
   git add -A && git commit -m "feat: description (vX.Y.Z)"
   ```
10. **Push to GitHub:**
    ```bash
    git push origin master
    ```
11. **Publish to npm:**
    ```bash
    npm publish
    ```
12. **Create annotated tag (triggers GitHub Release via CI):**
    ```bash
    git tag -a vX.Y.Z -m "vX.Y.Z - changelog summary"
    git push origin vX.Y.Z
    ```
13. **Verify GitHub Release** — check that the workflow ran and VSIX is attached
14. **Verify npm** — `npm info antigravity-autopilot version` shows new version

## Post-Release

15. **(Optional) Publish to VS Code Marketplace:**
    ```bash
    npx -y @vscode/vsce publish
    ```

## Common Mistakes to Avoid

- ❌ Forgetting to update README with new features
- ❌ Forgetting to bump version in `package.json`
- ❌ Publishing to npm before pushing to GitHub
- ❌ Not testing double-apply idempotency
- ❌ Using wrong branch name (`master` vs `main`)
- ❌ Wrong publisher ID in `package.json` for Marketplace
