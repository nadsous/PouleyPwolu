# Capture une fenêtre de PouleyPwolu (même avec Mica/GPU) dans un PNG.
#   powershell -ExecutionPolicy Bypass -File scripts\capture.ps1 [-Sortie C:\pwff\capture.png] [-Titre Tor]
# -Titre : capture la fenêtre PouleyPwolu dont le titre contient ce texte.
param([string]$Sortie = 'C:\pwff\capture.png', [string]$Titre = '')
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class PwCapture {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int L, T, R, B; }
  public static List<KeyValuePair<IntPtr, string>> Windows(uint[] pids) {
    var list = new List<KeyValuePair<IntPtr, string>>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (IsWindowVisible(h) && Array.IndexOf(pids, pid) >= 0) {
        var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
        if (sb.Length > 0) list.Add(new KeyValuePair<IntPtr, string>(h, sb.ToString()));
      }
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
'@
$pids = [uint32[]](Get-Process pouleypwolu -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$w = [PwCapture]::Windows($pids) | Where-Object { $_.Value -like "*$Titre*" } | Select-Object -First 1
if (-not $w) { throw 'Aucune fenêtre PouleyPwolu correspondante.' }
$r = New-Object PwCapture+RECT
[PwCapture]::GetWindowRect($w.Key, [ref]$r) | Out-Null
$bmp = New-Object Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
$g = [Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[PwCapture]::PrintWindow($w.Key, $hdc, 2) | Out-Null
$g.ReleaseHdc($hdc)
$bmp.Save($Sortie)
"$Sortie ($($bmp.Width)x$($bmp.Height)) : $($w.Value)"
