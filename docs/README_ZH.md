<p align="center">
  <img src="../src-tauri/icons/icon-macos.svg" width="120" height="120" alt="Votype Logo">
</p>

<h1 align="center">Votype</h1>

<p align="center">
  <strong>免费、开源、可扩展的语音转文字应用，完全本地运行。</strong>
</p>

<p align="center">
  <a href="https://github.com/zhuzhuyule/Votype/releases"><img src="https://img.shields.io/github/v/release/zhuzhuyule/Votype?style=flat-square" alt="Release"></a>
  <a href="https://github.com/zhuzhuyule/Votype/blob/main/LICENSE"><img src="https://img.shields.io/github/license/zhuzhuyule/Votype?style=flat-square" alt="License"></a>
  <a href="https://github.com/zhuzhuyule/Votype/stargazers"><img src="https://img.shields.io/github/stars/zhuzhuyule/Votype?style=flat-square" alt="Stars"></a>
</p>

<p align="center">
  <a href="#-核心功能">核心功能</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#%EF%B8%8F-支持的模型">模型支持</a> •
  <a href="#-ai-后处理">AI 处理</a> •
  <a href="#-参与贡献">参与贡献</a>
</p>

<p align="center">
  <b>语言 / Language:</b>&nbsp;&nbsp;
  <a href="../README.md">English</a> |
  <strong>中文</strong>
</p>

---

## ✨ 核心功能

### 🎤 本地语音识别

- **100% 离线** - 你的语音数据永远不会离开设备
- **多引擎支持** - Whisper、Sherpa-ONNX（Paraformer、SenseVoice、Transducer）、Parakeet
- **实时流式识别** - 边说边转，实时显示结果
- **自动语言检测** - 支持中文、英文、日语、韩语等多种语言
- **自定义词库** - 添加专业术语提高识别准确率

### 🔄 五种转录模式

Votype 支持多种转录模式，满足不同场景需求：

| 模式            | 说明                             | 适用场景                   |
| --------------- | -------------------------------- | -------------------------- |
| **🟢 实时转录** | Sherpa 流式模型，边说边显示文字  | 需要即时反馈的对话场景     |
| **🔵 模拟实时** | 录完后快速分批显示，模拟实时效果 | 追求准确度同时保持实时体验 |
| **🔵 完整转录** | Whisper 模型，录完后一次性转录   | 追求高准确度的正式场合     |
| **🌐 在线 API** | 云端 ASR，录完后一次性返回       | 追求最高准确度             |
| **🟣 混合模式** | 实时预览 + 在线 API 最终结果     | 兼顾体验和准确度           |

> 💡 **提示**：推荐使用 **混合模式**，既能边说边看到预览，又能获得最精确的最终结果。

### 🌐 在线 ASR（可选）

- **云端 ASR 集成** - 接入云服务获得更高准确率
- **混合模式** - 本地 + 云端结合，取长补短
- **双候选模式** - 同时使用本地和在线模型，结果对比

### 🤖 AI 后处理

- **LLM 增强** - 使用 AI 清理、格式化、优化转录结果
- **多供应商支持** - OpenAI、Anthropic、OpenRouter、Apple Intelligence 或自定义端点
- **命令别名** - 通过语音触发特定提示词（如"翻译成英文"）
- **自定义提示词** - 创建个性化处理流程，支持自定义图标

### 🎨 现代化界面

- **仪表盘** - 查看转录历史，支持音频回放
- **处理链徽章** - 清晰显示每条记录使用的模型
- **图标选择器** - 40+ 内置图标 + Iconify 在线搜索
- **主题定制** - 亮/暗模式、强调色、圆角大小
- **8 种语言** - 中文、English、日本語、한국어、Deutsch、Español、Français、Tiếng Việt

### ⚡ 高效生产力

- **全局快捷键** - 在任何应用中触发转录
- **按住说话** 或 切换模式
- **智能粘贴** - 直接输入、Ctrl+V 或剪贴板
- **录音浮窗** - 录音时实时反馈
- **音频反馈** - 可自定义的开始/结束提示音

---

## 🚀 快速开始

### 安装

#### macOS

1. **下载**：从 [Releases](https://github.com/zhuzhuyule/Votype/releases) 下载
2. **安装**：将 `Votype.app` 拖到应用程序文件夹
3. **首次启动**（重要！）：

   ```bash
   # 安装后运行此命令重新签名
   codesign --force --deep --sign - /Applications/Votype.app

   # 然后正常打开
   open /Applications/Votype.app
   ```

   > ⚠️ **为什么需要重新签名？** Votype 使用第三方动态库（Sherpa-ONNX），这些库有自己的代码签名。重新签名可以解决签名冲突，让 macOS 正常加载这些库。

4. **授予权限**（必需）：

   **麦克风权限**
   - 用途：录制你的语音进行转录
   - 时机：首次使用时提示
   - 设置：系统设置 → 隐私与安全性 → 麦克风 → 启用 Votype

   **辅助功能权限**（可选，但推荐）
   - 用途：文本粘贴和光标定位功能所需
   - 时机：首次使用粘贴功能时提示
   - 设置：系统设置 → 隐私与安全性 → 辅助功能 → 启用 Votype
   - 注意：没有此权限应用可以启动，但粘贴功能不可用

5. **开始使用**：
   - 按下快捷键（默认：`Option+Space`）
   - 说话并松开
   - 文字即刻出现！

#### Windows / Linux

1. 从 [Releases](https://github.com/zhuzhuyule/Votype/releases) 下载
2. 安装并授予麦克风权限
3. 按下快捷键（默认：`Ctrl+Space`）

### 系统要求

| 平台        | 要求                           |
| :---------- | :----------------------------- |
| **macOS**   | 10.13+，Intel 或 Apple Silicon |
| **Windows** | Windows 10+，x64 或 ARM64      |
| **Linux**   | x64，推荐 Ubuntu 22.04+        |

---

## 🗣️ 支持的模型

### 离线 ASR 引擎

| 引擎                  | 语言       | 速度      | 备注           |
| :-------------------- | :--------- | :-------- | :------------- |
| **Sherpa Paraformer** | 中、英、粤 | ⚡ 快速   | 支持流式       |
| **Sherpa SenseVoice** | 多语言     | ⚡ 快速   | 中文最佳       |
| **Sherpa Transducer** | 多种       | ⚡⚡ 最快 | Zipformer 架构 |
| **Whisper**           | 99 种语言  | 🔋 中等   | GPU 加速       |
| **Parakeet**          | 英语       | 🔋 中等   | CPU 优化       |

### 实时功能

- **VAD（语音活动检测）** - Silero 驱动
- **自动标点** - 自动添加标点符号
- **ITN（逆文本规范化）** - 将"二十五"转换为"25"

---

## 🤖 AI 后处理

将原始转录变成精美文本：

### 支持的供应商

| 供应商             | 备注                         |
| :----------------- | :--------------------------- |
| OpenAI             | GPT-4、GPT-3.5 等            |
| Anthropic          | Claude 系列模型              |
| OpenRouter         | 访问 100+ 种模型             |
| Apple Intelligence | 仅限 macOS 15+ Apple Silicon |
| 自定义             | 任何 OpenAI 兼容 API         |

### 命令别名

通过语音触发特定提示词：

- 说"翻译成英文"→ 触发翻译提示词
- 说"帮我总结"→ 触发总结提示词
- 可配置命令前缀（如"请"、"帮我"）

### 自定义提示词

创建工作流用于：

- 📝 语法和拼写纠正
- 🌐 翻译
- 📋 摘要
- 🔄 格式转换
- 每个提示词可设置自定义图标

---

## 🛠 技术架构

采用现代技术栈：

- **前端**：React 18、TypeScript、Tailwind CSS v4、Radix UI
- **后端**：Tauri v2 (Rust)、whisper-rs、sherpa-rs-sys
- **音频**：cpal、rubato、vad-rs (Silero)
- **状态**：Zustand、SQLite

---

## 🤝 参与贡献

欢迎贡献！详见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

```bash
# 克隆并设置
git clone https://github.com/zhuzhuyule/Votype.git
cd Votype
bun install

# 开发
bun tauri dev

# 构建
bun tauri build
```

---

## 📜 许可证

MIT 许可证 - 详见 [LICENSE](../LICENSE)。

---

## 🙏 致谢

- **OpenAI Whisper** - 语音识别模型
- **whisper.cpp & ggml** - 跨平台推理
- **Sherpa-ONNX** - 流式 ASR 框架
- **Silero** - 语音活动检测
- **Tauri** - 桌面应用框架

---

<p align="center">
  <i>"寻找语音转文字工具的旅程到此结束——不是因为 Votype 完美，而是因为你可以让它变得完美。"</i>
</p>
