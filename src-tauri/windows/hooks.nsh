; NSIS installer hooks (bundle.windows.nsis.installerHooks in tauri.conf.json).
; The in-game updater starts this installer and then quits, but the game can still be closing
; (WebView2 teardown) when the installer reaches slingshot-ops.exe: "Error opening file for writing".
; Ask it to close, give it a moment, then force it.
!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /IM slingshot-ops.exe'
  Sleep 1500
  nsExec::Exec 'taskkill /F /IM slingshot-ops.exe'
  Sleep 500
!macroend
