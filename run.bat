@echo off
chcp 65001 >nul 2>&1
title Pip Manager - Python 包管理器
cd /d "%~dp0"

echo ========================================
echo   Pip Manager 启动中...
echo ========================================

REM 检查 Python 是否可用
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Python，请确保已安装 Python 并添加到 PATH
    pause
    exit /b 1
)

REM 检查 flask 是否安装，未安装则自动安装
python -c "import flask" >nul 2>&1
if %errorlevel% neq 0 (
    echo [信息] 正在安装依赖 flask...
    python -m pip install flask
    if %errorlevel% neq 0 (
        echo [错误] flask 安装失败，请手动运行: python -m pip install flask
        pause
        exit /b 1
    )
)

echo [信息] 正在启动服务...
echo [信息] 浏览器请访问: http://127.0.0.1:5000
echo.

start "" http://127.0.0.1:5000
python app.py

pause
