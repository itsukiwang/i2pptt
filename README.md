# i2pptt

Images to PowerPoint Tool - 将图片目录转换为分组的 PowerPoint 演示文稿。

## 功能特性

- 📸 **图片扫描**：自动扫描图片目录，识别图片尺寸和方向
- 📊 **智能分组**：根据图片尺寸和目录结构自动分组
- 📑 **结构预览**：生成结构 Markdown 文件，预览分组结果
- 🎨 **PPT 生成**：根据结构文件自动生成 PowerPoint 演示文稿
- 🌐 **Web 界面**：提供现代化的 Web UI，支持拖拽上传、实时预览
- 📦 **ZIP 支持**：支持上传 ZIP 文件，自动解压并保持目录结构
- 🌍 **多语言**：支持中文和英文界面

## 项目结构

```
i2pptt/
├── cli/              # CLI 工具
│   ├── i2pptt.py    # 主程序
│   └── README.md    # CLI 使用说明
├── web/             # Web 应用
│   ├── backend/     # FastAPI 后端
│   ├── frontend/    # React 前端
│   └── README.md    # Web 使用说明
├── deploy/          # 部署配置
│   ├── nginx.conf.example
│   └── systemd/     # systemd 服务文件
├── i2pptt_service.sh # 服务管理脚本
└── README.md        # 本文件
```

## 快速开始

### CLI 使用

```bash
# 安装依赖
python3 -m venv venv
source venv/bin/activate
pip install -r cli/requirements.txt

# 扫描图片并生成结构文件
python -m i2pptt.cli.i2pptt scan -d /path/to/images -f output/deck.pptx

# 根据结构文件生成 PPT
python -m i2pptt.cli.i2pptt merge -d /path/to/images -f output/deck.pptx
```

详细说明请参考 [CLI README](cli/README.md)。

### Web 使用

```bash
# 启动服务
./i2pptt_service.sh start all

# 访问 http://localhost:5174/i2pptt
```

详细说明请参考 [Web README](web/README.md)。

## 安装

### 系统要求

- Python 3.12+
- Node.js 18+
- pip

### 安装步骤

1. **克隆仓库**

```bash
git clone <repository-url>
cd i2pptt
```

2. **安装 Python 依赖**

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r cli/requirements.txt
```

3. **安装前端依赖**

```bash
cd web/frontend
npm install
cd ../..
```

4. **配置应用**

```bash
cp web/settings.example.toml web/settings.toml
# 编辑 web/settings.toml
```

## 使用说明

### CLI 模式

CLI 工具提供两步工作流：

1. **扫描（scan）**：扫描图片目录，生成结构 Markdown 文件
2. **合并（merge）**：根据结构文件生成 PowerPoint 演示文稿

### Web 模式

Web 界面提供三步工作流：

1. **上传**：上传图片文件或 ZIP 压缩包
2. **分析**：自动扫描并生成结构预览
3. **生成**：生成并下载 PowerPoint 文件

## 配置

### CLI 配置

编辑 `cli/i2pptt.ini` 或通过命令行参数配置：

- `-d, --dir`: 图片根目录
- `-f, --filename`: PPT 输出路径
- `size`: PPT 幻灯片尺寸（16:9, 4:3, 或自定义）

### Web 配置

编辑 `web/settings.toml`：

```toml
[server]
root_path = "/i2pptt"
workers = 4
max_concurrent_users = 4
job_retention_hours = 24.0

[cli]
root = "../cli"

[files]
default_md_filename = "images"
default_ppt_filename = "images-{date}"
```

## 部署

生产环境部署请参考 [部署指南](deploy/README.md)。

## 设计规范

本项目遵循 `ppttt` 项目的设计规范，包括：

- CSS 共同定义
- 按钮状态与样式
- HTML 结构模式

详细说明请参考 `ppttt/docs/DESIGN_SPEC/`。

## 开发

### 后端开发

```bash
cd web
source ../venv/bin/activate
uvicorn backend.main:app --reload --port 8001
```

### 前端开发

```bash
cd web/frontend
npm run dev
```

## 许可证

[添加许可证信息]

## 贡献

欢迎提交 Issue 和 Pull Request。

## 更新日志

### v0.1.0

- 初始版本
- 支持 CLI 和 Web 两种模式
- 支持图片扫描和 PPT 生成
- 支持 ZIP 文件上传和自动解压
- 多语言支持（中文/英文）
- 遵循 ppttt 设计规范

