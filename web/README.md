# i2pptt Web

现代化的 Web UI 和 API，驱动 CLI 工作流（扫描 → 合并）。

## 功能特性

- 🎨 **现代化 UI**：基于 React 的响应式界面，遵循 ppttt 设计规范
- 📤 **文件上传**：支持拖拽上传，支持图片和 ZIP 文件
- 📊 **实时预览**：上传后自动分析，实时显示结构预览
- 🔄 **进度跟踪**：实时显示上传和分析进度
- 🌍 **多语言**：支持中文和英文界面
- 📱 **响应式设计**：适配不同屏幕尺寸

## 快速开始

### 开发模式

```bash
# 启动后端（端口 8001）
cd web
source ../venv/bin/activate
uvicorn backend.main:app --reload --port 8001

# 启动前端（端口 5174）
cd frontend
npm run dev
```

访问 http://localhost:5174/i2pptt

### 使用服务脚本

```bash
# 启动所有服务
./i2pptt_service.sh start all

# 检查状态
./i2pptt_service.sh status

# 停止服务
./i2pptt_service.sh stop all
```

## 配置

编辑 `web/settings.toml`：

```toml
[server]
root_path = "/i2pptt"              # Nginx 子路径
workers = 4                         # 后端工作进程数
max_concurrent_users = 4            # 最大并发用户数
job_retention_hours = 24.0          # 任务保留时间（小时）
session_timeout_seconds = 300       # 会话超时（秒）

[cli]
root = "../cli"                     # CLI 工具路径

[files]
default_md_filename = "images"      # 默认 MD 文件名
default_ppt_filename = "images-{date}"  # 默认 PPT 文件名模板
```

## 架构

### 后端（FastAPI）

- **端口**：8001（默认）
- **框架**：FastAPI
- **主要路由**：
  - `/api/upload` - 文件上传
  - `/api/analyze` - 图片分析
  - `/api/generate` - PPT 生成
  - `/api/jobs` - 任务管理

### 前端（React + Vite）

- **端口**：5174（默认）
- **框架**：React 18
- **构建工具**：Vite
- **主要组件**：
  - `Step1Upload` - 文件上传
  - `Step2Analyze` - 分析预览
  - `Step3Generate` - PPT 生成

## 部署

生产环境部署请参考 [部署指南](../deploy/README.md)。

### Nginx 配置示例

```nginx
location /i2pptt {
    proxy_pass http://127.0.0.1:5174;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
}

location /i2pptt/api/ {
    proxy_pass http://127.0.0.1:8001/i2pptt/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 200M;
}
```

详细配置请参考 `deploy/nginx.conf.example`。

## API 文档

启动后端后，访问 http://localhost:8001/docs 查看自动生成的 API 文档。

## 故障排查

### 常见问题

1. **前端页面空白**
   - 检查 `vite_base_path` 配置是否与 Nginx 的 `root_path` 匹配
   - 查看浏览器控制台错误信息

2. **API 404 错误**
   - 确认后端服务运行在正确端口
   - 检查 Nginx 的 `proxy_pass` 配置

3. **文件上传失败**
   - 检查 Nginx 的 `client_max_body_size` 设置
   - 查看后端日志

详细故障排查请参考 [部署指南](../deploy/README.md#故障排查)。

## 开发

### 代码规范

- 遵循 PEP 8（Python）
- 遵循 ESLint 规则（JavaScript/React）
- 遵循 ppttt 设计规范（UI/UX）

### 测试

```bash
# 后端测试
cd web
pytest

# 前端测试
cd frontend
npm test
```

## 更新日志

### v0.1.0

- 初始版本
- 三步工作流（上传 → 分析 → 生成）
- 支持 ZIP 文件上传和自动解压
- 多语言支持
- 遵循 ppttt 设计规范


