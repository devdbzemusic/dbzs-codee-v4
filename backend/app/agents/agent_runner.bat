@echo off
REM Wrapper script to run agent_loop.py with Python
REM This is needed because the backend (PyInstaller exe) cannot directly execute Python

setlocal enabledelayedexpansion

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0

REM Run python with the agent_loop module from the backend directory
REM The first argument is the path to agent_loop.py, followed by all other args
set AGENT_SCRIPT=%SCRIPT_DIR%agent_loop.py

python "%AGENT_SCRIPT%" %*
