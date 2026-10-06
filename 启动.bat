@echo off
cd /d "%~dp0"

set "PORT=8123"
set "ADDR=127.0.0.1"
set "URL=http://%ADDR%:%PORT%/"

title 像素画转换器 - 本地服务器

echo.
echo   ============================================
echo     像素画转换器 · 本地一键启动
echo   ============================================
echo.

REM ---- 查找可用的 Python ----
set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY where py >nul 2>nul && set "PY=py"
if not defined PY (
  echo   [错误] 未检测到 Python，无法启动本地服务器。
  echo   请先安装 Python 3： https://www.python.org/downloads/
  echo.
  pause
  exit /b 1
)

echo   访问地址： %URL%
echo   浏览器将自动打开；关闭本窗口即可完全停止并释放进程。
echo.

REM ---- 后台等待端口就绪后自动打开浏览器，随本窗口一同结束 ----
start /b "" powershell -NoProfile -Command "for($i=0;$i -lt 120;$i++){try{$c=New-Object Net.Sockets.TcpClient('%ADDR%',%PORT%);$c.Close();break}catch{Start-Sleep -Milliseconds 250}};Start-Process '%URL%'"

REM ---- 前台运行服务器：关闭本窗口 / 按 Ctrl+C 即结束进程 ----
%PY% -m http.server %PORT% --bind %ADDR%

echo.
echo   服务器已停止，进程已全部退出。
pause
