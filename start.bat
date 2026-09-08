@echo off
chcp 936 >nul
title 高斯查看器 - point_wlbwg
cd /d "%~dp0"

set "NODE_EXE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-2\node.exe"

if not exist "%NODE_EXE%" set "NODE_EXE=node"

echo [1/2] 构建 dist ...
"%NODE_EXE%" scripts\build.mjs
if errorlevel 1 goto :fail

echo.
echo [2/2] 启动服务 http://127.0.0.1:8123/
echo WebGPU 版（默认）：http://127.0.0.1:8123/
echo WebGL  版（兼容）：http://127.0.0.1:8123/?webgl=1
echo 按 Ctrl+C 停止服务
"%NODE_EXE%" scripts\serve.mjs 8123

goto :eof

:fail
echo 构建失败，请检查上方错误信息。
pause
