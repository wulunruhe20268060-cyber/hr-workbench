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

REM ---- Option A: self-hosted Doubao free API on Render (zero cost) ----
REM  Deploy doubao-free-api to your OWN Render account from the public Docker
REM  image vinlic/doubao-free-api:latest. Render: New -> Web Service ->
REM  "deploy an existing image from a registry", image=vinlic/doubao-free-api:latest,
REM  port 8000, health check path /ping. No GitHub repo needed.
REM  Then paste YOUR instance URL below. The public vercel instance is dead;
REM  self-hosting on Render (overseas) can reach www.doubao.com.
set DOUBAO_BASE_URL=https://your-doubao-instance.onrender.com/v1/chat/completions
set DOUBAO_SESSIONID=80b0e08fa724194ce8c7e8d6ff46cb92

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
