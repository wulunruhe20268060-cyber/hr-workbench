@echo off
REM ============================================================
REM  HR Workbench launcher (with Doubao AI)
REM  Stops any process on port 80, then starts server.js with AI env.
REM
REM  ONLY ONE STEP FOR YOU: paste your Volcengine Ark API Key on the
REM  AI_API_KEY line below (replace the __PASTE__ placeholder).
REM  Then save this file and double-click it.
REM ============================================================

REM Stop any service currently using port 80
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":80 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
timeout /t 2 /nobreak >nul

set DATA_DIR=F:/workbuddy/hr-team/data
set PORT=80

REM ============================================================
REM  Doubao OFFICIAL API via Volcengine Ark (RECOMMENDED)
REM  - Free quota: 500,000 tokens per model for new accounts
REM  - OpenAI-compatible protocol
REM  - Verified reachable from this machine (direct, no proxy)
REM  Console: https://console.volcengine.com/ark
REM  NOTE the path is /api/v3 (NOT /v1)
REM ============================================================
set AI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3/chat/completions
set AI_API_KEY=__PASTE_YOUR_VOLCENGINE_ARK_API_KEY__
set AI_MODEL=doubao-seed-2-0-mini-260428

REM ---- Alternative: SiliconFlow (also free quota, Qwen models) ----
REM  Remove REM from the 3 lines below AND add REM to the 3 lines above.
REM set AI_BASE_URL=https://api.siliconflow.cn/v1/chat/completions
REM set AI_API_KEY=sk-__YOUR_SILICONFLOW_KEY__
REM set AI_MODEL=Qwen/Qwen2.5-7B-Instruct

REM ============================================================
REM  DEAD END - do not use:
REM  doubao-free-api (sessionid reverse-engineering) is blocked by
REM  Doubao risk control (error 710022002 "block"). The project has
REM  been unmaintained since Dec 2024 and its a_bogus signature is
REM  fake, so www.doubao.com rejects every request. Local or Render,
REM  same result. Use the official Ark API above instead.
REM ============================================================

echo Starting HR Workbench with AI enabled...
"C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2/node.exe" "F:/workbuddy/hr-team/server.js"
pause
