# Antigravity Auto-Accept - Installation Script
# Creates a symlink in VS Code extensions directory for development

$ExtensionName = "antigravity-auto-accept"
$SourceDir = $PSScriptRoot
$VSCodeExtDir = Join-Path $env:USERPROFILE ".vscode\extensions\$ExtensionName"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Antigravity Auto-Accept Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if already installed
if (Test-Path $VSCodeExtDir) {
    Write-Host "[!] Extension already installed at: $VSCodeExtDir" -ForegroundColor Yellow
    $confirm = Read-Host "Remove and reinstall? (y/n)"
    if ($confirm -ne 'y') {
        Write-Host "Cancelled." -ForegroundColor Red
        exit 1
    }
    # Remove existing (handle both symlink and directory)
    if ((Get-Item $VSCodeExtDir).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        (Get-Item $VSCodeExtDir).Delete()
    } else {
        Remove-Item $VSCodeExtDir -Recurse -Force
    }
    Write-Host "[OK] Removed existing installation" -ForegroundColor Green
}

# Create symlink (requires admin or developer mode)
try {
    New-Item -ItemType SymbolicLink -Path $VSCodeExtDir -Target $SourceDir -ErrorAction Stop | Out-Null
    Write-Host "[OK] Created symlink:" -ForegroundColor Green
    Write-Host "     $VSCodeExtDir -> $SourceDir" -ForegroundColor DarkGray
} catch {
    Write-Host "[!] Symlink failed (may need admin or Developer Mode)." -ForegroundColor Yellow
    Write-Host "    Falling back to file copy..." -ForegroundColor Yellow
    
    New-Item -ItemType Directory -Path $VSCodeExtDir -Force | Out-Null
    Copy-Item -Path "$SourceDir\*" -Destination $VSCodeExtDir -Recurse -Force
    Write-Host "[OK] Copied files to: $VSCodeExtDir" -ForegroundColor Green
}

Write-Host ""
Write-Host "[NEXT] Reload VS Code:" -ForegroundColor Cyan
Write-Host "       Ctrl+Shift+P -> 'Developer: Reload Window'" -ForegroundColor White
Write-Host ""
