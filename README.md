# Pip Manager

一个基于 Web 的 Python 包管理器，提供可视化的 pip 包管理体验。支持多 Python 环境自动探测、包的安装/卸载、一键切换镜像源等功能。

## 功能特性

- **多环境自动探测** — 自动扫描系统中所有 Python 安装（py launcher、PATH、Microsoft Store、常见安装目录），按版本分类展示
- **包列表详情** — 显示每个包的名称、版本号、安装位置（site-packages 路径）
- **安装包** — 支持指定版本安装（如 `requests==2.31.0`），实时显示安装日志
- **卸载包** — 确认对话框 + 卸载日志输出
- **一键换源** — 直接输入镜像源地址即可切换，内置 7 个常用源（清华、阿里云、中科大、豆瓣、华为云、腾讯云、PyPI 官方），自动配置 `trusted-host`
- **升级 pip** — 每个环境可独立升级 pip 到最新版本
- **实时搜索** — 按包名即时过滤
- **镜像源状态** — 顶栏徽标显示当前源（官方/清华/自定义等）

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python + Flask |
| 前端 | 原生 HTML / CSS / JavaScript（无框架依赖） |
| 通信 | REST API + JSON |

## 项目结构

```
.
├── app.py              # Flask 后端，提供所有 API
├── static/
│   ├── index.html      # 前端页面
│   ├── style.css       # 暗色主题样式
│   └── app.js          # 前端交互逻辑
├── requirements.txt    # Python 依赖
└── run.bat             # Windows 一键启动脚本
```

## 快速开始

### 方式一：一键启动（Windows）

双击 `run.bat`，脚本会自动检查并安装 Flask 依赖，然后启动服务并打开浏览器。

### 方式二：手动启动

```bash
# 安装依赖
pip install -r requirements.txt

# 启动服务
python app.py
```

然后在浏览器访问 [http://127.0.0.1:5000](http://127.0.0.1:5000)。

## API 文档

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/python-installations` | GET | 获取系统中所有 Python 安装 |
| `/api/packages?python_path=...` | GET | 获取指定环境已安装的包列表 |
| `/api/install` | POST | 安装包 `{ python_path, package }` |
| `/api/uninstall` | POST | 卸载包 `{ python_path, package }` |
| `/api/mirror` | GET | 获取当前镜像源配置 |
| `/api/mirror` | POST | 设置镜像源 `{ index_url, trusted_host? }` |
| `/api/mirrors/preset` | GET | 获取预设镜像源列表 |
| `/api/upgrade-pip` | POST | 升级指定环境的 pip `{ python_path }` |

## 界面预览

- **暗色主题** — 开发者工具风格，信息密度高
- **左侧栏** — Python 环境列表，显示版本、来源、pip 版本
- **主区域** — 包表格，支持搜索过滤
- **顶部栏** — 镜像源状态徽标、刷新按钮

## 系统要求

- Python 3.7+
- 操作系统：Windows / macOS / Linux（Windows 下功能最完整）

## 许可证

MIT
