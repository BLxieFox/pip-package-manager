"""
Pip Manager - 后端服务
基于 Flask，提供 Python 安装环境探测、pip 包管理、镜像源切换等功能。
"""
import json
import os
import re
import sys
import shutil
import subprocess
import configparser
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder="static", static_url_path="")


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------

def run_command(cmd, timeout=120):
    """运行命令并返回结果，不抛异常。"""
    try:
        # 临时清除可能干扰的代理等环境变量，但保留 PATH
        env = os.environ.copy()
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
            env=env,
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "命令执行超时"
    except FileNotFoundError:
        return -1, "", f"找不到可执行文件: {cmd[0] if isinstance(cmd, list) else cmd}"
    except Exception as e:
        return -1, "", str(e)


def get_pip_config_path():
    """获取 pip 配置文件路径（Windows: pip.ini, 其他: pip.conf）。"""
    if sys.platform == "win32":
        config_dir = Path(os.environ.get("APPDATA", str(Path.home()))) / "pip"
    else:
        config_dir = Path.home() / ".config" / "pip"
    config_dir.mkdir(parents=True, exist_ok=True)
    config_file = config_dir / ("pip.ini" if sys.platform == "win32" else "pip.conf")
    return config_file


# ---------------------------------------------------------------------------
# Python 安装环境探测
# ---------------------------------------------------------------------------

def detect_python_installations():
    """探测系统中所有 Python 安装，返回列表。"""
    installations = []
    seen_paths = set()

    def add_python(python_exe, version_str=None, source=""):
        try:
            python_exe = str(Path(python_exe).resolve())
        except Exception:
            pass
        if python_exe in seen_paths:
            return
        if not Path(python_exe).exists():
            return

        # 获取版本和路径
        rc, out, err = run_command([python_exe, "--version"])
        version_raw = (out.strip() or err.strip())
        # 过滤 Windows Store 桩程序（返回错误信息而非版本号）
        if "was not found" in version_raw or "Microsoft Store" in version_raw:
            return
        version = version_str or version_raw.replace("Python ", "")
        # 仅保留形如 X.Y[.Z] 的版本
        if not re.match(r'^\d+\.\d+', version):
            return

        # 获取安装路径
        rc2, out2, _ = run_command([
            python_exe, "-c",
            "import sys; print(sys.executable); print(sys.prefix)"
        ])
        lines = [l.strip() for l in out2.strip().splitlines() if l.strip()]
        executable = lines[0] if lines else python_exe
        prefix = lines[1] if len(lines) > 1 else ""

        # 检查是否有 pip
        rc3, out3, _ = run_command([python_exe, "-m", "pip", "--version"])
        has_pip = rc3 == 0
        pip_version = ""
        if has_pip:
            parts = out3.split()
            for i, p in enumerate(parts):
                if p == "pip" and i + 1 < len(parts):
                    pip_version = parts[i + 1]
                    break

        seen_paths.add(executable)
        installations.append({
            "executable": executable,
            "prefix": prefix,
            "version": version,
            "pip_version": pip_version,
            "has_pip": has_pip,
            "source": source,
        })

    # 1. Windows py launcher
    if sys.platform == "win32":
        py_launcher = shutil.which("py")
        if py_launcher:
            rc, out, err = run_command([py_launcher, "-0p"])
            # 输出格式:  -V:3.11 *        C:\Python311\python.exe
            for line in (out + err).splitlines():
                line = line.strip()
                if not line or line.startswith("Installed"):
                    continue
                # 提取路径
                match = re.search(r'([A-Za-z]:\\[^\s].+\.exe)', line)
                if match:
                    add_python(match.group(1), source="py launcher")

    # 2. PATH 中的 python / python3
    for name in ["python", "python3", "python3.exe", "python.exe"]:
        path = shutil.which(name)
        if path:
            add_python(path, source="PATH")

    # 3. 当前运行的 Python
    add_python(sys.executable, source="current")

    # 4. Windows 常见安装目录
    if sys.platform == "win32":
        candidates = []
        local_app = os.environ.get("LOCALAPPDATA", "")
        program_files = os.environ.get("ProgramFiles", "C:\\Program Files")
        program_files_x86 = os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)")
        # Microsoft Store 版本
        if local_app:
            store_base = Path(local_app) / "Microsoft" / "WindowsApps"
            if store_base.exists():
                for p in store_base.iterdir():
                    if p.name.lower().startswith("python") and p.suffix.lower() == ".exe":
                        candidates.append(str(p))
        # 官方安装包
        for base in [program_files, program_files_x86]:
            if base:
                bp = Path(base)
                if bp.exists():
                    for p in bp.iterdir():
                        if p.name.lower().startswith("python"):
                            exe = p / "python.exe"
                            if exe.exists():
                                candidates.append(str(exe))
        for c in candidates:
            add_python(c, source="common dirs")

    # 去重（按可执行路径）
    unique = {}
    for inst in installations:
        key = inst["executable"].lower()
        if key not in unique:
            unique[key] = inst

    return list(unique.values())


def get_pip_packages(python_exe):
    """获取指定 Python 环境下所有已安装的 pip 包。"""
    rc, out, err = run_command([python_exe, "-m", "pip", "list", "--format=json"])
    if rc != 0:
        return [], f"获取包列表失败: {err or out}"

    try:
        packages = json.loads(out)
    except json.JSONDecodeError:
        return [], "解析包列表失败"

    # 获取每个包的详细信息（位置等）—— 批量获取
    rc2, out2, err2 = run_command([python_exe, "-m", "pip", "list", "--format=freeze"])
    detailed = []
    for pkg in packages:
        name = pkg.get("name", "")
        version = pkg.get("version", "")
        location = ""
        # 通过 pip show 获取位置（较慢但准确）
        rc3, out3, _ = run_command([python_exe, "-m", "pip", "show", name], timeout=30)
        if rc3 == 0:
            for line in out3.splitlines():
                if line.startswith("Location:"):
                    location = line.split(":", 1)[1].strip()
                    break
        detailed.append({
            "name": name,
            "version": version,
            "location": location,
        })

    return detailed, None


# ---------------------------------------------------------------------------
# 镜像源管理
# ---------------------------------------------------------------------------

def get_current_mirror():
    """读取当前 pip 镜像源配置。"""
    config_file = get_pip_config_path()
    if not config_file.exists():
        return {"index_url": "https://pypi.org/simple", "trusted_host": "", "config_path": str(config_file), "exists": False}

    config = configparser.ConfigParser()
    try:
        config.read(config_file, encoding="utf-8")
    except Exception:
        return {"index_url": "https://pypi.org/simple", "trusted_host": "", "config_path": str(config_file), "exists": True, "parse_error": True}

    index_url = "https://pypi.org/simple"
    trusted_host = ""
    if config.has_section("global"):
        if config.has_option("global", "index-url"):
            index_url = config.get("global", "index-url")
        if config.has_option("global", "trusted-host"):
            trusted_host = config.get("global", "trusted-host")

    return {
        "index_url": index_url,
        "trusted_host": trusted_host,
        "config_path": str(config_file),
        "exists": True,
    }


def set_mirror(index_url, trusted_host=None):
    """设置 pip 镜像源。"""
    config_file = get_pip_config_path()
    config = configparser.ConfigParser()

    if config_file.exists():
        try:
            config.read(config_file, encoding="utf-8")
        except Exception:
            pass

    if not config.has_section("global"):
        config.add_section("global")

    config.set("global", "index-url", index_url)

    # 如果未指定 trusted-host，尝试从 URL 推断
    if trusted_host is None:
        # 常见源自动添加 trusted-host
        known_mirrors = {
            "pypi.tuna.tsinghua.edu.cn": "pypi.tuna.tsinghua.edu.cn",
            "mirrors.aliyun.com": "mirrors.aliyun.com",
            "pypi.douban.com": "pypi.douban.com",
            "pypi.mirrors.ustc.edu.cn": "pypi.mirrors.ustc.edu.cn",
            "mirrors.huaweicloud.com": "mirrors.huaweicloud.com",
            "pypi.hustunique.com": "pypi.hustunique.com",
        }
        for host, trusted in known_mirrors.items():
            if host in index_url:
                trusted_host = trusted
                break

    if trusted_host:
        config.set("global", "trusted-host", trusted_host)
    elif config.has_option("global", "trusted-host"):
        config.remove_option("global", "trusted-host")

    config_file.parent.mkdir(parents=True, exist_ok=True)
    with open(config_file, "w", encoding="utf-8") as f:
        config.write(f)

    return get_current_mirror()


# ---------------------------------------------------------------------------
# API 路由
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/python-installations")
def api_python_installations():
    try:
        installations = detect_python_installations()
        return jsonify({"success": True, "data": installations})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/packages")
def api_packages():
    python_exe = request.args.get("python_path", "")
    if not python_exe:
        return jsonify({"success": False, "error": "缺少 python_path 参数"}), 400
    if not Path(python_exe).exists():
        return jsonify({"success": False, "error": f"路径不存在: {python_exe}"}), 400

    packages, error = get_pip_packages(python_exe)
    if error:
        return jsonify({"success": False, "error": error, "data": packages}), 500
    return jsonify({"success": True, "data": packages})


@app.route("/api/install", methods=["POST"])
def api_install():
    data = request.get_json(force=True)
    python_exe = data.get("python_path", "")
    package = data.get("package", "").strip()
    if not python_exe or not package:
        return jsonify({"success": False, "error": "缺少 python_path 或 package 参数"}), 400

    cmd = [python_exe, "-m", "pip", "install", package]
    rc, out, err = run_command(cmd, timeout=300)
    if rc != 0:
        return jsonify({"success": False, "error": err or out, "output": out})
    return jsonify({"success": True, "output": out})


@app.route("/api/uninstall", methods=["POST"])
def api_uninstall():
    data = request.get_json(force=True)
    python_exe = data.get("python_path", "")
    package = data.get("package", "").strip()
    if not python_exe or not package:
        return jsonify({"success": False, "error": "缺少 python_path 或 package 参数"}), 400

    cmd = [python_exe, "-m", "pip", "uninstall", "-y", package]
    rc, out, err = run_command(cmd, timeout=120)
    if rc != 0:
        return jsonify({"success": False, "error": err or out, "output": out})
    return jsonify({"success": True, "output": out})


@app.route("/api/mirror", methods=["GET"])
def api_get_mirror():
    return jsonify({"success": True, "data": get_current_mirror()})


@app.route("/api/mirror", methods=["POST"])
def api_set_mirror():
    data = request.get_json(force=True)
    index_url = data.get("index_url", "").strip()
    trusted_host = data.get("trusted_host", "").strip()
    if not index_url:
        return jsonify({"success": False, "error": "缺少 index_url 参数"}), 400
    result = set_mirror(index_url, trusted_host if trusted_host else None)
    return jsonify({"success": True, "data": result})


@app.route("/api/mirrors/preset")
def api_preset_mirrors():
    presets = [
        {"name": "PyPI 官方源", "url": "https://pypi.org/simple"},
        {"name": "清华大学", "url": "https://pypi.tuna.tsinghua.edu.cn/simple"},
        {"name": "阿里云", "url": "https://mirrors.aliyun.com/pypi/simple/"},
        {"name": "中国科技大学", "url": "https://pypi.mirrors.ustc.edu.cn/simple/"},
        {"name": "豆瓣", "url": "https://pypi.douban.com/simple/"},
        {"name": "华为云", "url": "https://mirrors.huaweicloud.com/repository/pypi/simple"},
        {"name": "腾讯云", "url": "https://mirrors.cloud.tencent.com/pypi/simple"},
    ]
    return jsonify({"success": True, "data": presets})


@app.route("/api/upgrade-pip", methods=["POST"])
def api_upgrade_pip():
    data = request.get_json(force=True)
    python_exe = data.get("python_path", "")
    if not python_exe:
        return jsonify({"success": False, "error": "缺少 python_path 参数"}), 400
    cmd = [python_exe, "-m", "pip", "install", "--upgrade", "pip"]
    rc, out, err = run_command(cmd, timeout=300)
    if rc != 0:
        return jsonify({"success": False, "error": err or out, "output": out})
    return jsonify({"success": True, "output": out})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
