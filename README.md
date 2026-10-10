# 媒体工具箱 v2

基于 Electron + FFmpeg 的桌面端音视频处理工具，界面为简体中文（深色主题）。内置 FFmpeg / FFprobe（ffmpeg-static / ffprobe-static）与 sharp 图片引擎，用户无需单独安装系统依赖。

## 功能一览

| 功能 | 说明 |
|------|------|
| 音视频压缩 | **批量**；高质量 / 平衡 / 小体积预设，可自定义 CRF 与音频码率；可选硬件加速 |
| 图片压缩 | **批量**；JPG / PNG / WebP（可保持原格式），预设或自定义质量；PNG 支持调色板量化 |
| 音视频分离 | **批量**；提取音频（MP3）或导出无声视频（流复制，无损） |
| 格式转换 | **批量**；MP4 / MKV / WebM / MP3 / AAC / WAV；MP4/MKV 可用硬件加速 |
| 裁剪截取 | 播放器预览 + 双滑块时间轴，**极速模式**（流复制）与**精准模式**（重新编码，帧级精确） |
| 媒体信息 | 时长、分辨率、编码、码率等 |
| 设置 | 输出目录、重名策略、文件名后缀、通知、完成后打开文件夹、并发数、硬件加速 |

### v2 新增

- **结果卡片**：每个任务完成后显示「原大小 → 输出大小，减少 xx%」（如 `128 MB → 34 MB，减少 73.4%`），并提供「打开文件」与「在访达中显示」（Windows 为「在资源管理器中显示」，Linux 为「在文件夹中显示」）。
- **批量处理与任务队列**（压缩 / 图片 / 分离 / 转换）：多选或一次拖入多个文件；每项显示状态（等待 / 处理中 / 完成 / 失败 / 已取消 / 已跳过）与独立进度，可单独取消、移除、重试；提供「全部开始」「全部取消」「清空已完成」；底部汇总共节省的体积。队列运行期间新加入的文件会自动按当前参数处理。
- **系统通知**：单个任务或整批任务完成 / 失败时发送系统通知（点击通知可定位输出文件），可在设置中关闭。
- **友好的错误提示**：常见错误映射为中文——磁盘空间不足、输入格式不支持或文件已损坏、文件被占用或无权限、找不到编码器、任务已取消、文件不存在；可展开「详细日志」查看 FFmpeg / sharp 原始输出尾部并一键复制。
- **更稳健的进度**：优先解析 `-progress pipe:1` 的 `out_time_us/out_time_ms`，缺失时回退到 stderr 的 `time=`；进度钳制在 0–100；无法获取总时长时显示**不确定进度条**和已处理时长。
- **安全写出**：先写入同目录隐藏临时文件，成功后再替换为目标文件；失败或取消时自动清理，绝不会产生半截文件，也绝不会覆盖源文件。
- 移除未使用的 `fluent-ffmpeg` 依赖。

## 裁剪截取

- 选中文件后可直接在应用内预览（通过自定义 `media://` 协议读取本地文件，支持 HTTP Range，可任意拖动进度；只允许访问用户主动选择 / 拖入的文件）。
- 播放器下方是双滑块时间轴：拖动蓝色 / 紫色手柄设置起点 / 终点，点击轨道跳转播放位置；手柄获得焦点后可用 ←/→ 微调 0.1 秒（Shift 为 1 秒）。
- 精确时间输入框（`时:分:秒.毫秒` / `分:秒.毫秒` / `秒`），与滑块双向同步，回车或失焦生效。
- 「预览选区」循环播放选中片段。
- Chromium 无法播放的格式（部分 MKV / AVI / HEVC 等）会显示「此格式无法预览，仍可按时间裁剪」，仍可通过时间轴和输入框裁剪。

| 模式 | 说明 |
|------|------|
| ⚡ 极速模式 | `-c copy` 流复制，几乎瞬间完成、无画质损失；起点会**吸附到最近的关键帧**，实际片段可能略早开始 |
| 🎯 精准模式 | 重新编码（H.264 CRF 18 + AAC 192k，音频文件按原格式编码），帧级精确；可使用硬件加速 |

### 快捷键（裁剪页面）

| 按键 | 作用 |
|------|------|
| `I` | 将当前播放位置设为起点 |
| `O` | 将当前播放位置设为终点 |
| `空格` | 播放 / 暂停 |
| `←` / `→` | 后退 / 前进 1 秒（按住 Shift 为 5 秒） |

（在输入框中输入时快捷键不生效。）

## 设置（侧边栏「设置」）

设置自动保存在 `app.getPath('userData')/settings.json`（macOS：`~/Library/Application Support/媒体工具箱/settings.json`）。

| 选项 | 默认 | 说明 |
|------|------|------|
| 输出位置 | 源文件同目录 | 或选择自定义文件夹 |
| 重名处理 | 自动加序号 | `name (1).mp4`、`name (2).mp4`…；也可选「覆盖」或「跳过」。任何策略都不会覆盖源文件 |
| 保留文件名后缀 | 开 | 如 `视频_压缩_平衡.mp4`；关闭后输出与源文件同名（同目录时自动加序号） |
| 系统通知 | 开 | 任务 / 批量完成或失败时通知 |
| 完成后打开所在文件夹 | 关 | 自动在文件管理器中定位输出文件 |
| 音视频并发数 | 2 | 压缩 / 分离 / 转换同时处理的任务数 |
| 图片并发数 | 4 | |
| 硬件加速 | 关 | 见下文 |

## 硬件加速说明

- 启动时后台执行 `ffmpeg -hide_banner -encoders` 列出候选硬件编码器，并用 lavfi 生成的极短片段**实际试编码**确认可用；结果显示在设置页，可「重新检测」。
  - macOS：`h264_videotoolbox`、`hevc_videotoolbox`
  - Windows：`h264_nvenc`、`h264_qsv`、`h264_amf`
  - Linux：`h264_nvenc`、`h264_qsv`、`h264_vaapi`（`/dev/dri/renderD128`）
- 用于：音视频压缩、转换为 MP4/MKV、精准裁剪。WebM（VP9）始终为软件编码。
- 硬件编码器不支持 CRF，质量预设按「分辨率 × 帧率 × 每像素比特」换算为目标码率（例如 1080p30：高质量约 6.2 Mbps / 平衡约 4.0 Mbps / 小体积约 2.5 Mbps），并以源码率的一定比例封顶（高 85% / 平衡 60% / 小 40%），保证压缩后不会变大；自定义 CRF 也会按比例换算。
- 硬件编码在运行时失败时会**自动回退到 libx264** 重新编码，并在结果中提示。
- 软件编码速度预设：高质量 CRF 18 / medium（原 slow，耗时过长）、平衡 CRF 23 / medium、小体积 CRF 28 / fast。

## 环境要求

- Node.js 18+（推荐 20）
- 构建安装包时需对应平台的 electron-builder 依赖

## 开发运行

```bash
npm install
npm run dev
```

## 构建安装包

```bash
npm run build:dir     # 仅打包目录（不生成安装器，便于调试）
npm run build:linux   # AppImage + deb
npm run build:win     # NSIS（建议在 Windows 上构建）
npm run build:mac     # macOS arm64 zip + 目录（需在 Mac 上构建）
```

### 在自己的 Mac 上构建

v2 移除了 `fluent-ffmpeg` 依赖，请在 Mac 上**重新安装依赖**后再构建（会自动下载 macOS 版 ffmpeg/ffprobe 与 sharp）：

```bash
cd ffmpeg-desktop
rm -rf node_modules        # 推荐：避免沿用其他平台的二进制
npm install
npm run build:mac
```

产物在 `dist/` 下（`媒体工具箱-2.0.0-arm64-mac.zip` 与 `dist/mac-arm64/媒体工具箱.app`）。应用未签名，首次打开如被拦截：右键 →「打开」，或执行 `xattr -cr "dist/mac-arm64/媒体工具箱.app"`。

## 冒烟测试与类型检查

```bash
npm run typecheck     # 渲染进程 + 主进程两套 tsconfig
npm run test:smoke    # = node scripts/smoke-test.mjs
```

冒烟测试用 esbuild 把 `electron/core/*` 编译后直接调用（不经过 UI），覆盖：压缩（软件编码 / 硬件失败回退）、MP4/WebM/MP3/WAV 转换、音频与无声视频分离、极速 / 精准裁剪（ffprobe 校验时长误差）、JPG/PNG/WebP 图片压缩（含 FFmpeg 备用引擎）、批量队列（并发、取消、移除、重试、清空）、重名策略（自动加序号 / 跳过 / 覆盖）、错误映射（损坏文件 → 中文提示）、未知时长进度、硬件编码器检测（无 GPU 时安全返回）、设置持久化、Range 解析。测试素材输出在 `samples/out/smoke/`。

## 技术结构

```
ffmpeg-desktop/
├── electron/
│   ├── main.ts            # 窗口、IPC、media:// 协议、通知、队列装配
│   ├── preload.ts         # contextBridge API（window.api）
│   ├── ffmpeg.ts          # 打包环境下 ffmpeg/ffprobe 路径解析（asar.unpacked）
│   ├── image-engine.ts    # 图片引擎（Linux 上隔离 sharp + FFmpeg 回退）
│   ├── image-worker.ts    # sharp 子进程（utilityProcess）
│   └── core/              # 纯逻辑模块，不依赖 Electron，可直接测试
│       ├── runner.ts      # spawn ffmpeg、-progress 解析、取消
│       ├── progress.ts    # 进度解析（纯函数）
│       ├── errors.ts      # 错误 → 中文映射
│       ├── media.ts       # 压缩 / 转换 / 分离 / 裁剪
│       ├── image.ts       # sharp 图片压缩 + FFmpeg 备用
│       ├── hwaccel.ts     # 硬件编码器检测与参数
│       ├── naming.ts      # 输出路径与重名策略
│       ├── queue.ts       # 通用任务队列
│       ├── tasks.ts       # 各功能的队列任务
│       ├── settings.ts    # 设置读写与校验
│       └── range.ts       # Range / media:// URL
├── shared/                # 主进程与渲染进程共享的类型与格式化函数
├── src/                   # React 界面
└── scripts/smoke-test.mjs
```

## 已知限制

- **Linux 上的 sharp**：sharp 0.33 内置的 glib 与部分 Linux 发行版（系统 glib 较新，如 Debian 13 / Ubuntu 24.10+ / Arch）上的 Electron 冲突，会在调用时直接崩溃。v2 在 Linux 上把 sharp 放到独立子进程运行，崩溃时自动改用 FFmpeg 编码图片（结果中会提示），应用本身不受影响。macOS / Windows 不受此问题影响，仍在主进程直接使用 sharp。
- 图片任务无法在 sharp 处理中途中止；取消后会在处理结束时删除结果文件。
- 极速裁剪受关键帧限制，起点可能略早；需要精确起点请用精准模式。

## 许可证

MIT
