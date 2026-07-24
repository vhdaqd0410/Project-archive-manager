@echo off
set CSC=C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe
set REFS=System.dll,System.Windows.Forms.dll,System.Drawing.dll,System.Core.dll,System.Data.dll,System.Web.Extensions.dll

%CSC% /target:winexe /reference:%REFS% /out:项目档案管理器.exe Program.cs Models.cs Services.cs MainForm.cs

if %ERRORLEVEL% EQU 0 (
    echo 编译成功！运行 项目档案管理器.exe
    start 项目档案管理器.exe
) else (
    echo 编译失败，请检查错误信息
)
pause
