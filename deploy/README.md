# i2pptt 部署指南

本文档说明如何在生产服务器上部署 i2pptt Web 应用。

## 前置要求

- Python 3.12+
- Node.js 18+
- Nginx
- systemd (可选，用于服务管理)

## 部署步骤

### 1. 安装依赖

```bash
# 创建 Python 虚拟环境
python3 -m venv venv
source venv/bin/activate

# 安装后端依赖（包含 CLI 和 Web 后端所需的所有包）
pip install -r web/requirements.txt

# 如果只需要 CLI 工具，可以使用：
# pip install -r cli/requirements.txt

# 安装前端依赖
cd web/frontend
npm install
cd ../..
```

### 2. 配置应用

复制并编辑配置文件：

```bash
cp web/settings.example.toml web/settings.toml
# 编辑 web/settings.toml，设置 root_path、workers 等
```

关键配置项：
- `server.root_path`: 应用在 Nginx 中的子路径（如 `/i2pptt`）
- `server.workers`: 后端工作进程数（生产环境建议 4+）
- `server.max_concurrent_users`: 最大并发用户数
- `server.job_retention_hours`: 任务保留时间（小时）

### 3. 配置 Nginx

```bash
# 复制配置文件
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/i2pptt

# 编辑配置文件，修改 server_name 和路径
sudo nano /etc/nginx/sites-available/i2pptt

# 创建符号链接
sudo ln -s /etc/nginx/sites-available/i2pptt /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重载 Nginx
sudo systemctl reload nginx
```

### 4. 启动服务

#### 方式一：使用服务脚本（推荐）

```bash
# 启动所有服务
./i2pptt_service.sh start all

# 检查状态
./i2pptt_service.sh status

# 停止服务
./i2pptt_service.sh stop all
```

#### 方式二：使用 systemd（生产环境推荐）

```bash
# 复制并编辑 systemd 服务文件
sudo cp deploy/systemd/i2pptt-backend.service.example /etc/systemd/system/i2pptt-backend.service
sudo cp deploy/systemd/i2pptt-frontend.service.example /etc/systemd/system/i2pptt-frontend.service

# 编辑服务文件，修改路径和用户
sudo nano /etc/systemd/system/i2pptt-backend.service
sudo nano /etc/systemd/system/i2pptt-frontend.service

# 启动服务
sudo systemctl daemon-reload
sudo systemctl enable i2pptt-backend i2pptt-frontend
sudo systemctl start i2pptt-backend i2pptt-frontend

# 检查状态
sudo systemctl status i2pptt-backend
sudo systemctl status i2pptt-frontend
```

### 5. 验证部署

```bash
# 检查服务是否运行
curl http://localhost:8001/i2pptt/health
curl http://localhost:5174/i2pptt/

# 检查 Nginx 代理
curl http://your-domain/i2pptt/health
```

## 端口配置

默认端口：
- 后端：8001
- 前端：5174

如需修改，请更新：
1. `i2pptt_service.sh` 中的端口变量
2. `deploy/nginx.conf.example` 中的 proxy_pass 地址
3. systemd 服务文件中的端口参数

## 故障排查

### 检查服务状态

```bash
# 使用服务脚本
./i2pptt_service.sh status

# 使用 systemd
sudo systemctl status i2pptt-backend
sudo systemctl status i2pptt-frontend

# 检查端口
lsof -i :8001  # 后端
lsof -i :5174  # 前端
```

### 查看日志

```bash
# 服务脚本日志
tail -f logs/backend.log
tail -f logs/frontend.log

# systemd 日志
sudo journalctl -u i2pptt-backend -f
sudo journalctl -u i2pptt-frontend -f

# Nginx 日志
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log
```

### 常见问题

1. **503 Service Unavailable**
   - 检查前端配置：`web/settings.toml` 中的 `vite_base_path` 必须与 Nginx 的 `root_path` 匹配
   - 检查服务是否运行：`./i2pptt_service.sh status`
   - 检查 Nginx 配置：`sudo nginx -t`

2. **API 404 错误**
   - 确认后端服务运行在正确端口
   - 检查 Nginx 的 `proxy_pass` 配置
   - 确认 `root_path` 配置正确

3. **文件上传失败**
   - 检查 Nginx 的 `client_max_body_size` 设置（默认 200M）
   - 检查后端日志中的错误信息

4. **前端资源 404**
   - 确认 `vite_base_path` 配置正确
   - 检查 Vite 开发服务器是否正常运行
   - 查看浏览器控制台的网络请求

## 生产环境建议

1. **使用 HTTPS**
   - 配置 SSL 证书
   - 更新 Nginx 配置启用 HTTPS
   - 设置 HTTP 到 HTTPS 的重定向

2. **资源限制**
   - 设置合理的 `max_concurrent_users`
   - 配置 `job_retention_hours` 自动清理旧任务
   - 监控磁盘空间使用

3. **监控和日志**
   - 配置日志轮转
   - 设置监控告警
   - 定期检查服务状态

4. **安全**
   - 限制 Nginx 访问来源（如需要）
   - 定期更新依赖包
   - 使用非 root 用户运行服务

## 更新应用

```bash
# 拉取最新代码
git pull

# 更新后端依赖
source venv/bin/activate
pip install -r cli/requirements.txt --upgrade

# 更新前端依赖
cd web/frontend
npm install
npm run build  # 如果使用静态部署
cd ../..

# 重启服务
./i2pptt_service.sh restart all
# 或
sudo systemctl restart i2pptt-backend i2pptt-frontend
```

