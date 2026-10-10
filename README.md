# 媒体工具箱

基于 Electron + FFmpeg 的桌面端音视频处理工具，界面为简体中文。内置 FFmpeg / FFprobe 与 sharp 图片引擎，用户无需单独安装系统依赖。

## 功能

| 功能 | 说明 |
|------|------|
| 音视频压缩 | 高质量 / 平衡 / 小体积预设，可自定义 CRF 与音频码率 |
| 图片压缩 | JPG / PNG / WebP，预设或自定义质量，可改输出格式 |
| 音视频分离 | 提取音频（MP3）或导出无声视频 |
| 格式转换 | MP4 / MKV / WebM / MP3 / AAC / WAV |
| 裁剪截取 | 按起止时间截取片段（流复制，速度快） |
| 媒体信息 | 时长、分辨率、编码、码率等 |

支持拖放选文件、进度显示、取消任务、打开输出所在文件夹。

## 环境要求

- Node.js 18+（推荐 20）
- 构建安装包时需对应平台的 electron-builder 依赖

## 开发运行

```bash
cd /workspace/ffmpeg-desktop
npm install
npm run dev
```

## 构建安装包

```bash
# 当前平台（Linux 上产出 AppImage + deb）
npm run build

# 仅打包目录（不生成安装器，便于调试）
npm run build:dir

# 指定平台
npm run build:linux   # AppImage + deb
npm run build:win     # NSIS（.exe，建议在 Windows 上构建）
npm run build:mac     # DMG（需在 macOS 上构建）
```

### 本机构建产物（Linux x64）

| 文件 | 说明 |
|------|------|
| `dist/媒体工具箱-1.0.0.AppImage` | 可直接执行的 AppImage（`chmod +x` 后双击或命令行运行） |
| `dist/media-toolbox_1.0.0_amd64.deb` | Debian/Ubuntu 安装包 |
| `dist/linux-unpacked/` | 未打包目录，可直接运行其中的 `media-toolbox` |

> **跨平台说明：** Windows / macOS 安装包建议在对应系统上执行 `npm run build:win` / `npm run build:mac`。本仓库已在 `package.json` → `build` 中配置 nsis / dmg / AppImage / deb 目标。

## 运行已构建的应用

```bash
# AppImage
chmod +x dist/媒体工具箱-1.0.0.AppImage
./dist/媒体工具箱-1.0.0.AppImage

# 或解包目录
./dist/linux-unpacked/media-toolbox

# deb 安装后
sudo dpkg -i dist/media-toolbox_1.0.0_amd64.deb
media-toolbox
```

## 技术栈

- Electron + Vite + React + TypeScript
- child_process 调用 **ffmpeg-static**、**ffprobe-static**
- 图片处理：**sharp**
- 打包：**electron-builder**

## 目录结构

```
ffmpeg-desktop/
├── electron/          # 主进程、FFmpeg/图片处理、preload
├── src/               # React 界面（简体中文）
├── resources/         # 应用图标
├── samples/           # 测试用样例文件
├── scripts/           # 冒烟测试脚本
├── dist-electron/     # 主进程构建输出
├── dist-renderer/     # 渲染进程构建输出
└── dist/              # 安装包输出
```

## 冒烟测试

```bash
node scripts/smoke-test.mjs
```

使用 `samples/` 下的短样例验证压缩、分离、转换、截取与图片压缩。

## 许可证

MIT
