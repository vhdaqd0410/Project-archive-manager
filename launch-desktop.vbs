Set ws = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
ws.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)

' 直接用 node_modules 里的 electron 可执行文件，不用 npx，秒开无黑窗
Dim electronExe
electronExe = ws.CurrentDirectory & "\node_modules\.bin\electron.cmd"
If Not fso.FileExists(electronExe) Then electronExe = ws.CurrentDirectory & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(electronExe) Then electronExe = "npx"

If Right(electronExe, 4) = "npx" Then
  ws.Run "npx electron .", 0, False
Else
  ws.Run """" & electronExe & """ .", 0, False
End If
