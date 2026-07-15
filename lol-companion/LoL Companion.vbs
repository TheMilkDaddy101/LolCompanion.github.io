' LoL Companion — desktop app launcher.
' Double-click this (or its shortcut) to use the companion like a normal app:
'  1. starts the server invisibly (no console window to accidentally close;
'     if it's already running this quietly does nothing), then
'  2. opens the UI in its own app window (no tabs, no address bar).
' Closing the window does NOT stop scouting — the server keeps running in
' the background until you sign out or end LoLCompanion.exe in Task Manager.
Option Explicit
Dim sh, fso, here, exe, url, edge, chrome
Set sh = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
exe = here & "\LoLCompanion.exe"
url = "http://localhost:3577"

' Start the server hidden. LOL_NO_OPEN stops it launching a browser tab
' itself; a second copy exits on its own when one is already running.
sh.Environment("PROCESS")("LOL_NO_OPEN") = "1"
If fso.FileExists(exe) Then
  sh.Run """" & exe & """", 0, False
  WScript.Sleep 1800
End If

' Open the UI as an app window — Edge ships with Windows; fall back to
' Chrome, then to the default browser as a last resort.
edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
If fso.FileExists(edge) Then
  sh.Run """" & edge & """ --app=" & url, 1, False
ElseIf fso.FileExists(chrome) Then
  sh.Run """" & chrome & """ --app=" & url, 1, False
Else
  sh.Run url, 1, False
End If
