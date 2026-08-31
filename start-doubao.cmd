@echo off
REM ============================================================
REM  HR Workbench launcher
REM  Stops any process on port 80, then starts server.js with AI env.
REM  Two AI modes below - uncomment the one you want.
REM ============================================================

REM Stop any service currently using port 80
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":80 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
timeout /t 2 /nobreak >nul

set DATA_DIR=F:/workbuddy/hr-team/data
set PORT=80

REM ---- Option A: Doubao free API (zero cost) ----
REM  Works on Render (overseas). On some local networks the vercel
REM  gateway is blocked, in which case use Option B instead.
set DOUBAO_SESSIONID=__PASTE_YOUR_SESSIONID_HERE__

REM ---- Option B: domestic free gateway (works locally) ----
REM  Uncomment the 3 lines below and fill your SiliconFlow key.
REM  SiliconFlow gives free quota on signup: https://cloud.siliconflow.cn
REM  Verified reachable from this machine. Any OpenAI-compatible gateway works.
REM set AI_BASE_URL=https://api.siliconflow.cn/v1
REM set AI_API_KEY=sk-__YOUR_SILICONFLOW_KEY__
REM set AI_MODEL=Qwen/Qwen2.5-7B-Instruct

echo Starting HR Workbench with AI enabled...
"C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2/node.exe" "F:/workbuddy/hr-team/server.js"
pause
