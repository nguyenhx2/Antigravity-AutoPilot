# Antigravity Auto-Accept - Floating Panel
# A small always-on-top window for toggling auto-accept
# Run with: powershell -WindowStyle Hidden -File AutoAccept.ps1

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", SetLastError=true)]
    public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@

# ---- State ----
$script:IsEnabled = $false
$script:Count = 0
$script:Timer = $null
$HWND_TOPMOST = [IntPtr](-1)
$SWP_NOSIZE = 0x0001
$SWP_NOMOVE = 0x0002

# ---- Fonts & Colors ----
$fontMain = New-Object System.Drawing.Font("Segoe UI", 9)
$fontBig = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
$fontMono = New-Object System.Drawing.Font("Consolas", 8)
$colorBg = [System.Drawing.Color]::FromArgb(30, 30, 30)
$colorPanel = [System.Drawing.Color]::FromArgb(40, 40, 40)
$colorOn = [System.Drawing.Color]::FromArgb(0, 200, 100)
$colorOff = [System.Drawing.Color]::FromArgb(100, 100, 100)
$colorText = [System.Drawing.Color]::White
$colorDim = [System.Drawing.Color]::FromArgb(160, 160, 160)
$colorAccent = [System.Drawing.Color]::FromArgb(90, 180, 255)

# ---- Main Form ----
$form = New-Object System.Windows.Forms.Form
$form.Text = "AG Auto-Accept"
$form.Size = New-Object System.Drawing.Size(280, 320)
$form.StartPosition = "Manual"
$form.Location = New-Object System.Drawing.Point(
    ([System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Right - 290),
    ([System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Bottom - 330)
)
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox = $false
$form.MinimizeBox = $true
$form.BackColor = $colorBg
$form.ForeColor = $colorText
$form.Font = $fontMain
$form.TopMost = $true
$form.ShowInTaskbar = $true

# ---- Title bar area ----
$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = "⚡ Antigravity Auto-Accept"
$lblTitle.Font = $fontBig
$lblTitle.ForeColor = $colorAccent
$lblTitle.Location = New-Object System.Drawing.Point(12, 12)
$lblTitle.Size = New-Object System.Drawing.Size(256, 24)
$form.Controls.Add($lblTitle)

$lblSub = New-Object System.Windows.Forms.Label
$lblSub.Text = "Tự động accept Antigravity commands"
$lblSub.Font = $fontMono
$lblSub.ForeColor = $colorDim
$lblSub.Location = New-Object System.Drawing.Point(12, 36)
$lblSub.Size = New-Object System.Drawing.Size(256, 16)
$form.Controls.Add($lblSub)

# ---- Separator ----
$sep = New-Object System.Windows.Forms.Label
$sep.Location = New-Object System.Drawing.Point(12, 57)
$sep.Size = New-Object System.Drawing.Size(254, 1)
$sep.BackColor = [System.Drawing.Color]::FromArgb(60, 60, 60)
$form.Controls.Add($sep)

# ---- Status indicator (big circle + text) ----
$pnlStatus = New-Object System.Windows.Forms.Panel
$pnlStatus.Location = New-Object System.Drawing.Point(12, 68)
$pnlStatus.Size = New-Object System.Drawing.Size(254, 80)
$pnlStatus.BackColor = $colorPanel
$form.Controls.Add($pnlStatus)

$picDot = New-Object System.Windows.Forms.PictureBox
$picDot.Location = New-Object System.Drawing.Point(16, 20)
$picDot.Size = New-Object System.Drawing.Size(40, 40)
$picDot.BackColor = [System.Drawing.Color]::Transparent
$pnlStatus.Controls.Add($picDot)

function Draw-Dot([bool]$on) {
    $bmp = New-Object System.Drawing.Bitmap(40, 40)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    if ($on) {
        $g.FillEllipse([System.Drawing.Brushes]::LimeGreen, 4, 4, 32, 32)
        # lightning bolt
        $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 2.5)
        $pts = @(
            [System.Drawing.Point]::new(24, 8),
            [System.Drawing.Point]::new(16, 22),
            [System.Drawing.Point]::new(22, 22),
            [System.Drawing.Point]::new(14, 32)
        )
        $g.DrawLines($pen, $pts)
        $pen.Dispose()
    }
    else {
        $g.FillEllipse([System.Drawing.Brushes]::DimGray, 4, 4, 32, 32)
        $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Gray, 2)
        $g.DrawLine($pen, 12, 12, 28, 28)
        $g.DrawLine($pen, 28, 12, 12, 28)
        $pen.Dispose()
    }
    $g.Dispose()
    $picDot.Image = $bmp
}
Draw-Dot $false

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Text = "OFF"
$lblStatus.Font = New-Object System.Drawing.Font("Segoe UI", 20, [System.Drawing.FontStyle]::Bold)
$lblStatus.ForeColor = $colorOff
$lblStatus.Location = New-Object System.Drawing.Point(66, 14)
$lblStatus.Size = New-Object System.Drawing.Size(100, 36)
$pnlStatus.Controls.Add($lblStatus)

$lblStatusSub = New-Object System.Windows.Forms.Label
$lblStatusSub.Text = "Click button to enable"
$lblStatusSub.Font = $fontMono
$lblStatusSub.ForeColor = $colorDim
$lblStatusSub.Location = New-Object System.Drawing.Point(66, 50)
$lblStatusSub.Size = New-Object System.Drawing.Size(180, 20)
$pnlStatus.Controls.Add($lblStatusSub)

# ---- Stats ----
$pnlStats = New-Object System.Windows.Forms.Panel
$pnlStats.Location = New-Object System.Drawing.Point(12, 158)
$pnlStats.Size = New-Object System.Drawing.Size(254, 50)
$pnlStats.BackColor = $colorPanel
$form.Controls.Add($pnlStats)

$lblCountLabel = New-Object System.Windows.Forms.Label
$lblCountLabel.Text = "Accepted"
$lblCountLabel.Font = $fontMono
$lblCountLabel.ForeColor = $colorDim
$lblCountLabel.Location = New-Object System.Drawing.Point(12, 8)
$lblCountLabel.Size = New-Object System.Drawing.Size(80, 16)
$pnlStats.Controls.Add($lblCountLabel)

$lblCount = New-Object System.Windows.Forms.Label
$lblCount.Text = "0"
$lblCount.Font = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$lblCount.ForeColor = $colorAccent
$lblCount.Location = New-Object System.Drawing.Point(100, 4)
$lblCount.Size = New-Object System.Drawing.Size(80, 30)
$pnlStats.Controls.Add($lblCount)

$lblUnit = New-Object System.Windows.Forms.Label
$lblUnit.Text = "commands"
$lblUnit.Font = $fontMono
$lblUnit.ForeColor = $colorDim
$lblUnit.Location = New-Object System.Drawing.Point(180, 10)
$lblUnit.Size = New-Object System.Drawing.Size(70, 16)
$pnlStats.Controls.Add($lblUnit)

# ---- Toggle Button ----
$btnToggle = New-Object System.Windows.Forms.Button
$btnToggle.Text = "▶  ENABLE AUTO-ACCEPT"
$btnToggle.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$btnToggle.Size = New-Object System.Drawing.Size(254, 44)
$btnToggle.Location = New-Object System.Drawing.Point(12, 220)
$btnToggle.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnToggle.FlatAppearance.BorderSize = 0
$btnToggle.BackColor = [System.Drawing.Color]::FromArgb(0, 150, 80)
$btnToggle.ForeColor = $colorText
$btnToggle.Cursor = [System.Windows.Forms.Cursors]::Hand
$form.Controls.Add($btnToggle)

# ---- Interval label ----
$lblInterval = New-Object System.Windows.Forms.Label
$lblInterval.Text = "Interval: 800ms  |  Only when VS Code focused"
$lblInterval.Font = $fontMono
$lblInterval.ForeColor = $colorDim
$lblInterval.Location = New-Object System.Drawing.Point(12, 274)
$lblInterval.Size = New-Object System.Drawing.Size(254, 16)
$lblInterval.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$form.Controls.Add($lblInterval)

# ---- System tray icon ----
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Text = "Antigravity Auto-Accept: OFF"
$tray.Visible = $true

$trayBmp = New-Object System.Drawing.Bitmap(16, 16)
$tg = [System.Drawing.Graphics]::FromImage($trayBmp)
$tg.Clear([System.Drawing.Color]::Transparent)
$tg.FillEllipse([System.Drawing.Brushes]::CornflowerBlue, 1, 1, 14, 14)
$tg.Dispose()
$tray.Icon = [System.Drawing.Icon]::FromHandle($trayBmp.GetHicon())

$trayMenu = New-Object System.Windows.Forms.ContextMenuStrip
$trayShow = New-Object System.Windows.Forms.ToolStripMenuItem "Show Panel"
$trayToggle = New-Object System.Windows.Forms.ToolStripMenuItem "Enable Auto-Accept"
$traySep = New-Object System.Windows.Forms.ToolStripSeparator
$trayExit = New-Object System.Windows.Forms.ToolStripMenuItem "Exit"
$trayMenu.Items.AddRange(@($trayShow, $trayToggle, $traySep, $trayExit))
$tray.ContextMenuStrip = $trayMenu

# ---- Core: Send Alt+A ----
function Send-AltA {
    $fgWnd = [WinAPI]::GetForegroundWindow()
    $fgPid = 0
    [WinAPI]::GetWindowThreadProcessId($fgWnd, [ref]$fgPid) | Out-Null
    $fgProc = Get-Process -Id $fgPid -ErrorAction SilentlyContinue
    if ($fgProc -and $fgProc.ProcessName -match 'Code') {
        [System.Windows.Forms.SendKeys]::SendWait("%a")
        $script:Count++
        $lblCount.Text = "$($script:Count)"
        $tray.Text = "AG Auto-Accept: ON ($($script:Count) accepted)"
    }
}

# ---- Toggle logic ----
function Toggle {
    $script:IsEnabled = -not $script:IsEnabled

    if ($script:IsEnabled) {
        $script:Count = 0
        $lblCount.Text = "0"

        # Start timer
        $script:Timer = New-Object System.Windows.Forms.Timer
        $script:Timer.Interval = 800
        $script:Timer.Add_Tick({ Send-AltA })
        $script:Timer.Start()

        # Update UI
        $lblStatus.Text = "ON"
        $lblStatus.ForeColor = $colorOn
        $lblStatusSub.Text = "Sending Alt+A every 800ms..."
        $btnToggle.Text = "⏸  DISABLE AUTO-ACCEPT"
        $btnToggle.BackColor = [System.Drawing.Color]::FromArgb(180, 50, 50)
        $pnlStatus.BackColor = [System.Drawing.Color]::FromArgb(20, 60, 30)
        $trayToggle.Text = "Disable Auto-Accept"
        $tray.Text = "AG Auto-Accept: ON"
        Draw-Dot $true

        $tray.ShowBalloonTip(2000, "Auto-Accept ON", "Tự động accept Antigravity commands", [System.Windows.Forms.ToolTipIcon]::Info)
    }
    else {
        if ($script:Timer) {
            $script:Timer.Stop()
            $script:Timer.Dispose()
            $script:Timer = $null
        }

        # Update UI
        $lblStatus.Text = "OFF"
        $lblStatus.ForeColor = $colorOff
        $lblStatusSub.Text = "Click button to enable"
        $btnToggle.Text = "▶  ENABLE AUTO-ACCEPT"
        $btnToggle.BackColor = [System.Drawing.Color]::FromArgb(0, 150, 80)
        $pnlStatus.BackColor = $colorPanel
        $trayToggle.Text = "Enable Auto-Accept"
        $tray.Text = "AG Auto-Accept: OFF"
        Draw-Dot $false
    }
}

# ---- Event handlers ----
$btnToggle.Add_Click({ Toggle })
$trayToggle.Add_Click({ Toggle })
$trayShow.Add_Click({ $form.Show(); $form.BringToFront() })
$tray.Add_DoubleClick({ $form.Show(); $form.BringToFront() })
$trayExit.Add_Click({
        if ($script:Timer) { $script:Timer.Stop(); $script:Timer.Dispose() }
        $tray.Visible = $false
        $tray.Dispose()
        $form.Close()
    })
$form.Add_FormClosing({
        param($s, $e)
        # Minimize to tray instead of closing
        if ($e.CloseReason -eq [System.Windows.Forms.CloseReason]::UserClosing) {
            $e.Cancel = $true
            $form.Hide()
            $tray.ShowBalloonTip(1500, "Still running!", "Double-click tray icon to reopen.", [System.Windows.Forms.ToolTipIcon]::Info)
        }
    })

# Keep always on top
$form.Add_Shown({
        [WinAPI]::SetWindowPos($form.Handle, $HWND_TOPMOST, 0, 0, 0, 0, ($SWP_NOSIZE -bor $SWP_NOMOVE)) | Out-Null
    })

# ---- Launch ----
$tray.ShowBalloonTip(2500, "Antigravity Auto-Accept", "✅ Running! Click toggle button to enable.", [System.Windows.Forms.ToolTipIcon]::Info)
[System.Windows.Forms.Application]::Run($form)
