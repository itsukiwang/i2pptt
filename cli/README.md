# i2pptt CLI

通过两步工作流（扫描 → 合并）将图片目录转换为分组的 PowerPoint 演示文稿。

## 安装

```bash
# 创建虚拟环境
python3 -m venv venv
source venv/bin/activate

# 安装依赖
pip install -r cli/requirements.txt
```

## 使用方法

### 基本用法

```bash
# 步骤 1：扫描图片并生成结构文件
python -m i2pptt.cli.i2pptt scan -d /path/to/images -f output/deck.pptx

# 步骤 2：根据结构文件生成 PPT
python -m i2pptt.cli.i2pptt merge -d /path/to/images -f output/deck.pptx
```

### 命令行参数

- `-d, --dir, --directory`: 图片根目录
- `-f, --filename`: PPT 输出路径
  - `scan` 命令会生成 `<filename>_structure.md` 文件
  - `merge` 命令会读取该结构文件并生成 PPT

### 配置文件

编辑 `cli/i2pptt.ini` 或通过 `--config` 参数指定配置文件。

#### PPT 尺寸配置

在 `cli/i2pptt.ini` 中配置：

```ini
size = 16:9  # 默认值，可选：4:3 或 custom

# 自定义尺寸（当 size = custom 时）
width_in = 10
height_in = 7.5
```

#### 图片处理

- 所有图片都放置在正方形框架（1:1 单元格）中
- 图片保持原始宽高比，居中适配（不拉伸）

## 结构 Markdown 格式

`scan` 命令会生成结构 Markdown 文件，格式如下：

```markdown
# i2pptt structure

root: /absolute/path/to/images

## slide: a (1/2)
- a/1.png | 1.png | 1920x1080 | landscape
- a/2.png | 2.png | 1920x1080 | landscape

## slide: a (2/2)
- a/3.png | 3.png | 1080x1920 | portrait
```

### 格式说明

- `root`: 图片根目录的绝对路径
- `## slide: <group_name> (<index>/<total>)`: 幻灯片分组
- 每行格式：`<relative_path> | <filename> | <width>x<height> | <orientation>`
  - `relative_path`: 相对于根目录的路径
  - `filename`: 文件名
  - `widthxheight`: 图片尺寸
  - `orientation`: 方向（`landscape` 或 `portrait`）

## 示例

### 示例 1：基本使用

```bash
# 扫描图片目录
python -m i2pptt.cli.i2pptt scan -d ./images -f output/presentation.pptx

# 查看生成的结构文件
cat output/presentation_structure.md

# 生成 PPT
python -m i2pptt.cli.i2pptt merge -d ./images -f output/presentation.pptx
```

### 示例 2：自定义配置

```bash
# 使用自定义配置文件
python -m i2pptt.cli.i2pptt scan -d ./images -f output/presentation.pptx --config custom.ini
```

## 工作流程

1. **扫描阶段（scan）**
   - 递归扫描指定目录中的所有图片
   - 识别图片尺寸和方向
   - 根据尺寸和目录结构自动分组
   - 生成结构 Markdown 文件

2. **合并阶段（merge）**
   - 读取结构 Markdown 文件
   - 根据分组创建 PowerPoint 幻灯片
   - 将图片插入到对应的幻灯片中
   - 保存 PPT 文件

## 注意事项

- 确保图片目录路径正确
- 支持常见图片格式（JPG, PNG, GIF 等）
- 大文件处理可能需要较长时间
- 建议在生成 PPT 前先检查结构文件

## 故障排查

### 常见问题

1. **找不到图片文件**
   - 检查目录路径是否正确
   - 确认图片文件存在且可读

2. **结构文件格式错误**
   - 检查结构文件是否完整
   - 确认文件编码为 UTF-8

3. **PPT 生成失败**
   - 检查图片文件是否损坏
   - 确认有足够的磁盘空间
   - 查看错误日志

## 与 Web 版本的关系

CLI 工具是 Web 版本的后端核心。Web 界面通过 API 调用 CLI 工具完成图片扫描和 PPT 生成。

- Web 版本提供图形界面和文件上传功能
- CLI 版本适合批量处理和自动化场景



