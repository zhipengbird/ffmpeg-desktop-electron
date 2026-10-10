# 变更日志 (CHANGELOG)

本项目遵循 [Semantic Versioning (语义化版本 2.0.0)](https://semver.org/lang/zh-CN/) 规范。
本文件记录「媒体工具箱 (Media Toolbox)」每个版本的功能新增、性能优化、缺陷修复与底层架构演进。

---

## [v2.2.0] - 2026-10-10 (进行中 🚀)

### 🌟 新增功能 (Features)
- **🎯 锁定目标大小压缩模式 (Target File Size)**：
  - 解决微信 (20 MB)、企业邮箱 (25 MB)、钉钉 (10 MB)、平台附件 (50 MB) 等严格体积限制痛点；
  - 核心算法基于媒体时长精确反算视频流与音频流目标码率，预留 5% 封装协议开销，结合平均码率与峰值缓冲限速，确保最终体积 100% 不超限；
  - 输出文件名自动增加目标规格后缀（如 `_压缩_目标20MB.mp4`）。
- **🎞️ 高清双遍调色板 GIF 制作 (Video to GIF)**：
  - 在「格式转换」中接入高质量调色板双遍复合滤镜管线（`palettegen` 抽取全局最佳 256 色 + `paletteuse` 差分 Bayer 抖动合成）；
  - 彻底消除传统 GIF 的大面积噪点与色彩断层，体积更小，色彩过渡丝滑自然；
  - 支持独立配置动图帧率（`10 / 15 / 24 fps`）与缩放宽度（`320px / 480px / 640px / 原始尺寸`）。
- **🚀 现代动态 WebP 制作 (Animated WebP)**：
  - 采用 FFmpeg 原生 `libwebp_anim` 动画编码引擎，支持 24 位 1670 万真彩色与平滑循环（`-loop 0`）；
  - 相比传统 GIF 动图，同画质下文件体积缩减 **30% ～ 50%**，专为公众号、社交媒体与现代网页设计。

### 🧪 自动化测试
- 冒烟测试套件扩展至 **47 项自动化测试**（新增目标体积压制、高清 GIF 调色板生成、Animated WebP 编码验证），持续保持 100% 通过率。

### 📚 文档体系
- 新建 [PRODUCT.md](file:///Users/yuanpinghua/Desktop/%E5%BC%80%E6%BA%90%E9%A1%B9%E7%9B%AE/ffmpeg-desktop-electron/PRODUCT.md)（产品定位、用户痛点、功能全景图与交互工程细节）；
- 建立 [CHANGELOG.md](file:///Users/yuanpinghua/Desktop/%E5%BC%80%E6%BA%90%E9%A1%B9%E7%9B%AE/ffmpeg-desktop-electron/CHANGELOG.md) 追踪记录每个版本的特性变更与缺陷修复；
- 在 [ROADMAP.md](file:///Users/yuanpinghua/Desktop/%E5%BC%80%E6%BA%90%E9%A1%B9%E7%9B%AE/ffmpeg-desktop-electron/ROADMAP.md) 中细化阶段二能力演进状态。

---

## [v2.1.0] - 2026-10-10

### 🌟 新增功能 (Features)
- **📊 Dock / 任务栏原生进度条**：
  - 主进程聚合全部后台活动队列与单文件剪辑任务，动态计算全局加权进度；
  - 调用 `mainWindow.setProgressBar` 实现最小化至后台时在 macOS Dock 和 Windows 任务栏显示实时进度，遇到错误时显示红色告警。
- **🖱️ 原生拖拽导出 (Native Drag Out)**：
  - 批量队列与结果卡片支持 `draggable` + `webContents.startDrag({ file, icon })`；
  - 转换/压缩完成的文件，按住结果卡片可直接拖拽至桌面、任意文件夹或直接拖入微信、飞书聊天框发送。
- **🎵 零损耗原音流提取 (audio-copy)**：
  - 「音视频分离」新增原音频提取模式，采用 `-c:a copy` 解封装流复制；
  - 自动识别源视频音频编码（AAC ➔ `.m4a`，Opus ➔ `.opus`，FLAC ➔ `.flac` 等），耗时 0.1 秒秒出，音质 100% 无损。
- **⌨️ 专业剪辑快捷键体系**：
  - <kbd>Space</kbd>：播放 / 暂停视频；
  - <kbd>[</kbd> / <kbd>I</kbd>：将当前播放头位置设为截取起点；
  - <kbd>]</kbd> / <kbd>O</kbd>：将当前播放头位置设为截取终点；
  - <kbd>←</kbd> / <kbd>→</kbd>：逐帧微调 0.1s（按住 <kbd>Shift</kbd> 加速跳转 1s）；
  - <kbd>Esc</kbd>：分层递进取消（输入框失焦 ➔ 取消正在运行任务 ➔ 暂停播放 ➔ 重置结果 ➔ 清空当前文件）。

### 🐛 缺陷修复与体验打磨 (Bug Fixes & Polish)
- **中文输入法快捷键兼容**：优先基于硬件物理键码 `e.code` 捕获（`BracketLeft` / `BracketRight` / `KeyI` / `KeyO`），并兼顾中文全角符 `【` 与 `】`，彻底消除拼音输入法状态下按键失灵的问题；
- **操作即时反馈 (Toast)**：设置起点、终点、暂停或取消时，播放器右上角弹出半透明胶囊动画提示，解决初始 0 秒时设起点无视觉变化的困惑；
- **单任务进度聚合修复**：修复当批量队列为空时单任务进度条被阻断置为 -1 的逻辑缺陷；
- **原生拖拽图标缺省兜底**：增加物理图标存在性多级检测，缺失时安全回退至 `nativeImage.createEmpty()`，防止 Native API 异常；
- **媒体重选状态清理**：在清空媒体时同步重置 `url`、`duration`、`current` 及加载状态，杜绝连续切换文件时旧画面的瞬间闪烁。

---

## [v2.0.0] - 2026-10-09

### 🏗️ 架构与系统重构 (Architecture)
- **解耦独立核心引擎 (`electron/core/`)**：
  - 将所有 FFmpeg 命令行封装、图片处理、队列调度与设置存储抽离为纯 TypeScript 无界面引擎；
  - 核心逻辑 100% 脱机可测试，彻底解耦 Electron 主进程事件。
- **多进程类型共享 (`shared/types.ts`)**：
  - 统一前后端数据模型、状态枚举、设置契约与结果结构，杜绝 IPC 契约漂移。
- **并发批量任务队列 (`TaskQueue`)**：
  - 支持多文件拖拽追加、独立并发上限控制、动态暂停、取消、重试与错误收集。
- **跨平台 GPU 硬件加速引擎**：
  - 自动探活 macOS (VideoToolbox)、Windows (NVENC/QSV/AMF)、Linux (VAAPI)；
  - 启动阶段自动生成短片试编，若 GPU 驱动异常则平滑回退至 `libx264` 软编。
- **自定义 `media://` Range 流式协议**：
  - 拦截并响应 HTTP Range 请求，实现 GB 级本地大文件极速打开与精确拖动预览；
  - 配合 LRU 白名单防路径穿越与内存泄露。
- **Linux Sharp utilityProcess 隔离**：
  - 采用独立进程运行 Sharp 图片处理，避免 Node/Electron glib 符号冲突；异常时自动降级至 FFmpeg 引擎。
- **43 项全流程自动化冒烟测试**：
  - 脱机覆盖探测、格式转换、极速/精准裁剪、图片压缩、并发排队、错误日志提取全流程。
