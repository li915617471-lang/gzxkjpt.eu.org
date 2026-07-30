Option Explicit

Dim shell, fileSystem, projectDir, siteUrl, serverCommand, attempt
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

projectDir = fileSystem.GetParentFolderName(WScript.ScriptFullName)
siteUrl = "http://127.0.0.1:8010/"

If WScript.Arguments.Named.Exists("check") Then
  If IsServerReady(siteUrl) Then
    WScript.Echo "ready"
  Else
    WScript.Echo "not-ready"
  End If
  WScript.Quit 0
End If

If Not IsServerReady(siteUrl) Then
  serverCommand = "cmd.exe /c cd /d """ & projectDir & """ && python -m http.server 8010 --bind 127.0.0.1"
  shell.Run serverCommand, 0, False

  For attempt = 1 To 10
    WScript.Sleep 400
    If IsServerReady(siteUrl) Then Exit For
  Next
End If

If WScript.Arguments.Named.Exists("startonly") Then WScript.Quit 0

shell.Run siteUrl, 1, False

Function IsServerReady(url)
  Dim request
  IsServerReady = False
  On Error Resume Next
  Set request = CreateObject("WinHttp.WinHttpRequest.5.1")
  request.SetTimeouts 500, 500, 500, 500
  request.Open "GET", url, False
  request.Send
  If Err.Number = 0 Then IsServerReady = (request.Status >= 200 And request.Status < 500)
  Set request = Nothing
  Err.Clear
  On Error GoTo 0
End Function
