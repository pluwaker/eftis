Option Explicit

Dim fso, shell, scriptDir, targetPyw, cmd, rc
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
targetPyw = scriptDir & "\EFT Assistant.pyw"

If Not fso.FileExists(targetPyw) Then
    MsgBox "File not found: " & targetPyw, vbCritical, "EFT Assistant"
    WScript.Quit 1
End If

' Try pyw (Python Launcher for Windows) first, then pythonw
rc = 1
On Error Resume Next
rc = shell.Run("pyw -3 """ & targetPyw & """", 0, False)
If Err.Number <> 0 Or rc <> 0 Then
    Err.Clear
    rc = shell.Run("pythonw """ & targetPyw & """", 0, False)
End If
On Error GoTo 0

If rc <> 0 Then
    MsgBox "Python 3 (pythonw / pyw) was not found in PATH." & vbCrLf & _
           "Please install Python 3.10+ from python.org and check 'Add Python to PATH'.", _
           vbExclamation, "EFT Assistant"
    WScript.Quit 1
End If
