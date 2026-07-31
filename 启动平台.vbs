Option Explicit

Dim shell
Set shell = CreateObject("WScript.Shell")

' Open the deployed site directly. This avoids localhost blocking and console windows.
shell.Run "https://li915617471-lang.github.io/gzxkjpt.eu.org/", 1, False
