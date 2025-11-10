# Handy 远程API转录功能设计文档

## 📋 文档概述

本文档记录了为Handy项目添加远程API转录功能的完整设计方案。该功能允许用户选择使用远程API服务进行语音转录，而非本地模型推理。

**创建时间**: 2025-11-10
**设计者**: AI Assistant
**状态**: 设计完成，待实施

---

## 🎯 项目背景

### Handy项目简介

Handy是一个开源的语音转文本桌面应用程序，具有以下核心特性：

- **完全离线**: 默认使用本地Whisper/Parakeet模型
- **跨平台**: 支持macOS、Windows、Linux
- **隐私保护**: 音频数据完全本地处理
- **实时转录**: 支持全局快捷键触发
- **历史记录**: SQLite数据库存储转录历史和音频文件

### 当前架构

```
前端 (React/TypeScript)
    ↓ Tauri API调用
后端 (Rust/Tauri)
├── 音频录制管理器 (AudioRecordingManager)
├── 模型管理器 (ModelManager)
├── 转录管理器 (TranscriptionManager)
├── 历史管理器 (HistoryManager)
└── 设置系统
```

---

## 🔄 新需求分析

### 需求1: AI大模型润色功能
**现状**: 项目已有完整的AI后处理系统
- 支持OpenAI、Anthropic等多种provider
- 自定义prompt模板
- 后处理结果存储在历史记录中

**兼容性**: ✅ **完全兼容** - 可以直接复用现有AI后处理功能

### 需求2: 前端显示转录状态
**现状**: 当前方案是异步转录完成后一次性更新
**新需求**: 前端需要显示转录进度状态，支持手动编辑结果后再插入

**兼容性**: ✅ **简化实现** - 通过状态更新和进度指示器实现，无需流式API

### 需求3: 模型缓存系统和Online ASR功能
**现状**: 当前Post Process系统已有Provider配置和模型选择功能
**新需求**: 实现模型缓存系统，支持Online ASR功能，将模型选择与Provider配置分离

**兼容性**: ✅ **扩展实现** - 在现有Post Process系统基础上扩展

---

## 📋 业务逻辑需求

### 核心业务目标

实现模型缓存系统和Online ASR功能，将模型选择与Provider配置分离，各功能模块只关心已缓存的对应类型模型。

---

### 业务需求1: 模型缓存系统

#### 功能描述
- 从Provider API获取模型列表（复用现有的`fetch_post_process_models`）
- 选择模型加入缓存，并标记能力类型（Text/ASR/Other）
- 管理已缓存的模型（查看、修改能力类型、删除）

#### 数据结构
- `CachedModel`: id, name, model_id, provider_id, capability, added_at
- `ModelCapability`: Text（文本处理）、ASR（语音识别）、Other（其他）
- `AppSettings.cached_models`: 存储所有缓存模型

#### 业务规则
- 模型从当前选中的Provider获取
- 添加模型时需要指定能力类型（默认Text）
- 可以修改已缓存模型的能力类型
- 删除模型时，如果该模型被选中，需要清空相关选择

---

### 业务需求2: Provider配置统一管理

#### 功能描述
- 在独立界面统一管理Provider配置（API Key、Base URL等）
- 与模型选择分离，功能设置不关心Provider如何配置

#### 当前实现
- Provider配置已在`PostProcessingSettingsApi`组件中实现
- 包含：Provider选择、Base URL、API Key、模型列表获取

#### 业务规则
- Provider配置独立管理
- 模型缓存和功能设置不关心Provider如何配置
- 只需要知道Provider ID即可获取配置

---

### 业务需求3: Online ASR功能

#### 功能描述
- 提供Online ASR开关
- 启用时：从已缓存的ASR类型模型中选择一个用于转录
- 禁用时：使用本地Whisper模型

#### 数据结构
- `AppSettings.online_asr_enabled`: Online ASR开关
- `AppSettings.selected_asr_model_id`: 选中的ASR模型ID

#### 业务规则
- 开关启用时，转录使用选中的ASR模型
- 开关禁用时，使用本地Whisper模型
- 模型选择下拉框只显示ASR类型的缓存模型
- 未选择模型时，应提示用户先添加ASR模型

#### 待实现
- 后端：在`TranscriptionManager::transcribe()`中添加Online ASR分支
- 后端：实现Audio API客户端，调用远程ASR API
- 后端：音频格式转换（Vec<f32> → WAV bytes）

---

### 业务需求4: Post Process模型选择

#### 功能描述
- 在Prompt设置中，从已缓存的Text类型模型中选择一个用于后处理
- 替换现有的`post_process_models`选择逻辑

#### 数据结构
- `AppSettings.selected_post_process_model_id`: 选中的Text模型ID

#### 业务规则
- 模型选择下拉框只显示Text类型的缓存模型
- 使用缓存的模型ID调用Chat API
- 从`ProviderConfigManager`获取Provider配置和API Key

#### 待实现
- 后端：修改`maybe_post_process_transcription()`使用缓存模型
- 后端：从`selected_post_process_model_id`获取模型信息
- 后端：从`ProviderConfigManager`获取Provider配置

---

### 数据流设计

```
用户操作流程：

1. Provider配置（统一界面）
   └─> 配置API Key、Base URL等
   └─> 获取模型列表

2. 模型缓存管理
   └─> 从Provider API获取模型列表
   └─> 选择模型添加到缓存
   └─> 标记模型能力（Text/ASR/Other）

3. ASR设置
   └─> 启用Online ASR
   └─> 从已缓存的ASR模型中选择
   └─> 不需要关心Provider配置

4. Post Process设置
   └─> 配置Prompt
   └─> 从已缓存的Text模型中选择
   └─> 不需要关心Provider配置
```

---

### 关键设计原则

1. **职责分离**
   - Provider配置：统一管理
   - 模型缓存：能力标识系统
   - 功能模块：只关心模型选择

2. **数据流向**
   - Provider配置 → 模型缓存 → 功能使用
   - 单向依赖，避免循环

3. **用户体验**
   - 各功能界面只显示相关模型（ASR设置只显示ASR模型，Post Process只显示Text模型）
   - Provider配置独立管理，不混在功能设置中

---

### UI设计参考

#### 布局结构
- **左侧边栏**：Provider列表（带搜索）+ 每个Provider的开关
- **右侧内容区**：选中Provider的详细配置（API Key、API地址、模型列表）

#### Provider列表（左侧）
- 显示所有Provider列表
- 每个Provider显示：图标、名称、独立开关（ON/OFF）
- 支持搜索过滤Provider
- 点击Provider项，右侧显示该Provider的详细配置
- 当前选中的Provider高亮显示

#### Provider配置（右侧）
- 标题栏：Provider名称 + 外部链接图标 + 独立开关
- API密钥：输入框（带显示/隐藏）+ 检测按钮 + 获取密钥链接
- API地址：输入框 + 提示文本（如 /结尾忽略 v1 版本）
- 模型列表：
  - 显示模型数量
  - 按Provider分组的可折叠模型组
  - 每个模型显示：图标、名称、特殊标记（如星标）
  - 提供"管理"和"添加"按钮

#### 模型缓存管理（集成到Provider配置中）
- 模型列表显示在选中Provider的配置区域
- 模型按Provider分组显示（可折叠）
- 从当前Provider的可用模型列表中选择模型添加到缓存
- 添加模型时设置能力类型（Text/ASR/Other）
- 显示已缓存的模型，并标记能力类型
- 提供"管理"按钮进入模型管理界面

---

### 待实现的后端功能

#### 1. 数据结构扩展（已完成）
- `CachedModel`结构体
- `ModelCapability`枚举
- `AppSettings`新字段

#### 2. 后端命令（已完成）
- `add_cached_model`
- `update_cached_model_capability`
- `remove_cached_model`
- `select_asr_model`
- `select_post_process_model`
- `toggle_online_asr`

#### 3. Online ASR实现（待实现）
- 创建`OnlineAsrManager`
- 实现Audio API客户端
- 音频格式转换工具
- 集成到`TranscriptionManager::transcribe()`

#### 4. Post Process更新（待实现）
- 修改`maybe_post_process_transcription()`使用缓存模型
- 创建`ProviderConfigManager`统一获取Provider配置

---

### 前端实现状态

#### 已完成
- 类型定义扩展
- Settings Store更新
- 模型缓存管理组件（基础版本）
- Online ASR设置组件（基础版本）
- Post Process模型选择

#### 待优化
- Provider列表组件（左侧边栏）
- Provider配置组件（右侧内容区）
- 模型列表集成到Provider配置中
- 搜索功能
- 模型分组显示

---

## 🏗️ 设计方案

### 核心设计理念

**保持现有架构不变，新增异步远程转录分支**，实现"录制即保存，转录异步完成"的用户体验。

### 工作流程对比

#### 本地转录流程 (现有)
```
录制 → 转录 → AI润色 → 保存历史记录
    ↓     ↓      ↓        ↓
  同步   同步    同步     同步
```

#### 远程转录流程 (新增)
```
录制 → 保存历史记录 → 异步远程转录 → AI润色 → 更新结果
    ↓        ↓            ↓          ↓        ↓
  同步     同步         异步       可选     异步
```

---

## 📁 技术实现方案

### Phase 1: 配置系统扩展 (3-4天)

#### 1.1 前端设置界面

```typescript
interface RemoteTranscriptionSettings {
  enabled: boolean;
  apiEndpoint: string;
  apiKey: string;
  timeoutSeconds: number;
  maxRetries: number;
  enableAutoPolish: boolean;         // 启用自动润色
  polishProvider: string;            // 润色使用的AI provider
}
```

#### 1.2 远程转录客户端

```rust
// src-tauri/src/remote_transcription.rs (新建)
pub struct RemoteTranscriptionClient {
    client: reqwest::Client,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ApiConfig {
    pub endpoint: String,
    pub api_key: String,
    pub timeout_seconds: u64,
    pub max_retries: u32,
    pub provider: ApiProvider,  // 新增：API提供商类型
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub enum ApiProvider {
    OpenAI,
    Azure,
    Google,
    Custom,
}

impl RemoteTranscriptionClient {
    pub async fn transcribe_audio(&self, audio_path: &Path, config: &ApiConfig) -> Result<String> {
        let adapter = self.get_adapter(&config.provider);
        adapter.transcribe_audio(audio_path, config).await
    }

    fn get_adapter(&self, provider: &ApiProvider) -> Box<dyn TranscriptionApiAdapter> {
        match provider {
            ApiProvider::OpenAI => Box::new(OpenAIApiAdapter),
            ApiProvider::Azure => Box::new(AzureApiAdapter),
            ApiProvider::Google => Box::new(GoogleApiAdapter),
            ApiProvider::Custom => Box::new(CustomApiAdapter),
        }
    }
}
```

#### 1.3 API兼容性适配器系统

```rust
// src-tauri/src/api_adapters.rs (新建)
use async_trait::async_trait;
use reqwest::RequestBuilder;
use serde_json::Value;
use std::path::Path;

use crate::remote_transcription::ApiConfig;

#[async_trait]
pub trait TranscriptionApiAdapter: Send + Sync {
    /// 验证API配置
    async fn validate_config(&self, config: &ApiConfig) -> Result<(), String>;

    /// 构建API请求
    async fn build_request(&self, audio_path: &Path, config: &ApiConfig) -> Result<RequestBuilder, String>;

    /// 解析API响应
    async fn parse_response(&self, response_text: &str) -> Result<String, String>;

    /// 默认实现：执行转录
    async fn transcribe_audio(&self, audio_path: &Path, config: &ApiConfig) -> Result<String, String> {
        self.validate_config(config).await?;

        let client = reqwest::Client::new();
        let request = self.build_request(audio_path, config).await?;
        let response = client.execute(request).await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("API request failed: {}", response.status()));
        }

        let response_text = response.text().await
            .map_err(|e| format!("Failed to read response: {}", e))?;

        self.parse_response(&response_text).await
    }
}
```

#### 1.4 具体API适配器实现

```rust
// OpenAI适配器
pub struct OpenAIApiAdapter;

#[async_trait]
impl TranscriptionApiAdapter for OpenAIApiAdapter {
    async fn validate_config(&self, config: &ApiConfig) -> Result<(), String> {
        if !config.endpoint.contains("openai.com") {
            return Err("Invalid OpenAI endpoint".to_string());
        }
        if !config.api_key.starts_with("sk-") {
            return Err("Invalid OpenAI API key format".to_string());
        }
        Ok(())
    }

    async fn build_request(&self, audio_path: &Path, config: &ApiConfig) -> Result<RequestBuilder, String> {
        let audio_data = tokio::fs::read(audio_path).await
            .map_err(|e| format!("Failed to read audio file: {}", e))?;

        let form = reqwest::multipart::Form::new()
            .part("file", reqwest::multipart::Part::bytes(audio_data)
                .file_name("audio.wav")
                .mime_str("audio/wav")
                .map_err(|e| format!("Failed to create form part: {}", e))?)
            .part("model", reqwest::multipart::Part::text("whisper-1"));

        let request = reqwest::Client::new()
            .post(&config.endpoint)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .multipart(form)
            .timeout(std::time::Duration::from_secs(config.timeout_seconds));

        Ok(request)
    }

    async fn parse_response(&self, response_text: &str) -> Result<String, String> {
        let json: Value = serde_json::from_str(response_text)
            .map_err(|e| format!("Failed to parse JSON: {}", e))?;

        json["text"]
            .as_str()
            .ok_or_else(|| "Missing 'text' field in response".to_string())
            .map(|s| s.to_string())
    }
}

// Azure适配器
pub struct AzureApiAdapter;

#[async_trait]
impl TranscriptionApiAdapter for AzureApiAdapter {
    async fn validate_config(&self, config: &ApiConfig) -> Result<(), String> {
        if !config.endpoint.contains("azure") {
            return Err("Invalid Azure endpoint".to_string());
        }
        Ok(())
    }

    async fn build_request(&self, audio_path: &Path, config: &ApiConfig) -> Result<RequestBuilder, String> {
        let audio_data = tokio::fs::read(audio_path).await
            .map_err(|e| format!("Failed to read audio file: {}", e))?;

        let form = reqwest::multipart::Form::new()
            .part("audio", reqwest::multipart::Part::bytes(audio_data)
                .file_name("audio.wav")
                .mime_str("audio/wav")
                .map_err(|e| format!("Failed to create form part: {}", e))?);

        let request = reqwest::Client::new()
            .post(&config.endpoint)
            .header("Ocp-Apim-Subscription-Key", &config.api_key)
            .multipart(form)
            .timeout(std::time::Duration::from_secs(config.timeout_seconds));

        Ok(request)
    }

    async fn parse_response(&self, response_text: &str) -> Result<String, String> {
        let json: Value = serde_json::from_str(response_text)
            .map_err(|e| format!("Failed to parse JSON: {}", e))?;

        // Azure返回格式可能不同
        json["DisplayText"]
            .as_str()
            .or_else(|| json["text"].as_str())
            .ok_or_else(|| "Missing transcription text in response".to_string())
            .map(|s| s.to_string())
    }
}

// Google适配器
pub struct GoogleApiAdapter;

#[async_trait]
impl TranscriptionApiAdapter for GoogleApiAdapter {
    async fn validate_config(&self, config: &ApiConfig) -> Result<(), String> {
        if !config.endpoint.contains("google") {
            return Err("Invalid Google endpoint".to_string());
        }
        Ok(())
    }

    async fn build_request(&self, audio_path: &Path, config: &ApiConfig) -> Result<RequestBuilder, String> {
        let audio_data = tokio::fs::read(audio_path).await
            .map_err(|e| format!("Failed to read audio file: {}", e))?;

        // Google Speech-to-Text API格式
        let request_body = serde_json::json!({
            "config": {
                "encoding": "LINEAR16",
                "sampleRateHertz": 16000,
                "languageCode": "en-US"
            },
            "audio": {
                "content": base64::encode(&audio_data)
            }
        });

        let request = reqwest::Client::new()
            .post(&config.endpoint)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .header("Content-Type", "application/json")
            .body(request_body.to_string())
            .timeout(std::time::Duration::from_secs(config.timeout_seconds));

        Ok(request)
    }

    async fn parse_response(&self, response_text: &str) -> Result<String, String> {
        let json: Value = serde_json::from_str(response_text)
            .map_err(|e| format!("Failed to parse JSON: {}", e))?;

        // Google返回格式
        json["results"][0]["alternatives"][0]["transcript"]
            .as_str()
            .ok_or_else(|| "Missing transcript in Google response".to_string())
            .map(|s| s.to_string())
    }
}

// 自定义API适配器
pub struct CustomApiAdapter;

#[async_trait]
impl TranscriptionApiAdapter for CustomApiAdapter {
    async fn validate_config(&self, config: &ApiConfig) -> Result<(), String> {
        // 自定义API的验证逻辑可以更宽松
        if config.endpoint.is_empty() {
            return Err("Endpoint is required".to_string());
        }
        Ok(())
    }

    async fn build_request(&self, audio_path: &Path, config: &ApiConfig) -> Result<RequestBuilder, String> {
        let audio_data = tokio::fs::read(audio_path).await
            .map_err(|e| format!("Failed to read audio file: {}", e))?;

        // 自定义API使用标准multipart格式
        let form = reqwest::multipart::Form::new()
            .part("audio", reqwest::multipart::Part::bytes(audio_data)
                .file_name("audio.wav")
                .mime_str("audio/wav")
                .map_err(|e| format!("Failed to create form part: {}", e))?);

        let request = reqwest::Client::new()
            .post(&config.endpoint)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .multipart(form)
            .timeout(std::time::Duration::from_secs(config.timeout_seconds));

        Ok(request)
    }

    async fn parse_response(&self, response_text: &str) -> Result<String, String> {
        let json: Value = serde_json::from_str(response_text)
            .map_err(|e| format!("Failed to parse JSON: {}", e))?;

        // 尝试常见的字段名
        json["text"]
            .as_str()
            .or_else(|| json["transcript"].as_str())
            .or_else(|| json["result"].as_str())
            .ok_or_else(|| "No transcription text found in response".to_string())
            .map(|s| s.to_string())
    }
}
```

### Phase 3: AI润色集成 (2-3天)

#### 3.1 复用现有AI后处理系统

```rust
// 在远程转录完成后自动触发润色
impl TranscriptionManager {
    pub async fn polish_transcription(&self, history_id: i64, original_text: &str) -> Result<String> {
        // 复用现有的maybe_post_process_transcription函数
        let settings = get_settings(&self.app_handle);
        if let Some(polished_text) = maybe_post_process_transcription(&settings, original_text).await {
            // 更新历史记录
            self.update_history_polish(history_id, &polished_text).await?;
            Ok(polished_text)
        } else {
            Ok(original_text.to_string())
        }
    }
}
```

#### 3.2 润色配置扩展

```rust
// settings.rs 中添加远程转录专用的润色配置
#[derive(Serialize, Deserialize, Clone)]
pub struct RemotePolishConfig {
    pub enabled: bool,
    pub provider_id: String,
    pub prompt_id: String,
}
```

### Phase 4: 录制流程修改 (2-3天)

#### 4.1 增强的录制动作

```rust
impl ShortcutAction for TranscribeAction {
    fn stop(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        let settings = get_settings(&ah);
        if settings.remote_transcription_enabled {
            // 远程模式：立即保存，异步转录
            let history_id = hm.save_transcription(
                samples_clone,
                String::new(), // 转录文本暂时为空
                None,
                None
            ).await?;

            // 异步提交远程转录任务
            tm.submit_remote_transcription(history_id);

            // 如果启用自动润色，设置润色任务
            if settings.enable_auto_polish {
                tm.schedule_auto_polish(history_id);
            }
        } else {
            // 本地模式保持不变
            let transcription = tm.transcribe(samples)?;
            hm.save_transcription(samples, transcription, ...).await?;
        }
    }
}
```

---

## 📊 重新组织的实施计划

### 🎯 **总体策略**
- **从外到内**: 先处理配置和UI，再处理核心逻辑
- **低风险优先**: 先做可回滚的配置和界面修改
- **并行开发**: 识别可以并行开发的任务
- **渐进验证**: 每个阶段都有可验证的成果

### ⭐ **复杂度评估标准**
- **⭐**: 简单 - 主要是CRUD操作，风险低
- **⭐⭐**: 低复杂度 - 需要一些业务逻辑，风险中等
- **⭐⭐⭐**: 中等复杂度 - 需要设计抽象，风险中等
- **⭐⭐⭐⭐**: 高复杂度 - 涉及核心逻辑修改，风险较高

---

### **阶段1: 基础设施搭建 (低复杂度，1-2周)**

#### **1.1 配置系统扩展** ⭐⭐ (3-4天)
**复杂度**: 低 - 主要是数据结构和UI组件
**风险**: 低 - 可完全回滚
**并行**: 可独立开发

- [ ] 添加远程API配置的数据结构 (`ApiConfig`, `ApiProvider`)
- [ ] 扩展前端设置界面组件
- [ ] 实现基本的配置保存和加载
- [ ] 添加配置验证逻辑

#### **1.2 API适配器框架** ⭐⭐⭐ (4-5天)
**复杂度**: 中等 - 需要设计良好的抽象
**风险**: 低 - 不影响现有功能
**并行**: 可与1.1并行

- [ ] 设计`TranscriptionApiAdapter` trait
- [ ] 实现基础的适配器管理器
- [ ] 创建OpenAI适配器 (作为参考实现)
- [ ] 添加基本的错误处理框架

#### **1.3 前端状态管理** ⭐⭐ (2-3天)
**复杂度**: 低 - 主要是React状态管理
**风险**: 低 - UI层面修改
**并行**: 可与1.1并行

- [ ] 扩展历史记录状态 (添加转录状态字段)
- [ ] 实现前端状态同步hooks
- [ ] 添加基本的进度指示器UI
- [ ] 实现状态变更通知

---

### **阶段2: 核心功能实现 (中等复杂度，2-3周)**

#### **2.1 远程转录客户端** ⭐⭐⭐ (3-4天)
**复杂度**: 中等 - 网络请求和错误处理
**风险**: 中等 - 涉及网络调用
**依赖**: 阶段1.2

- [ ] 实现`RemoteTranscriptionClient`核心逻辑
- [ ] 添加网络请求封装和重试机制
- [ ] 实现音频文件上传处理
- [ ] 添加请求超时和取消支持

#### **2.2 转录管理器扩展** ⭐⭐⭐⭐ (4-5天)
**复杂度**: 高 - 修改核心业务逻辑
**风险**: 中等 - 影响录制流程
**依赖**: 阶段2.1, 阶段1.3

- [ ] 扩展`TranscriptionManager`添加异步任务管理
- [ ] 实现`submit_remote_transcription`方法
- [ ] 修改录制动作逻辑 (分支处理)
- [ ] 添加任务状态跟踪和清理

#### **2.3 更多API适配器** ⭐⭐ (2-3天)
**复杂度**: 低 - 基于已有的框架
**风险**: 低 - 新增功能
**并行**: 可与阶段2.1并行

- [ ] 实现Azure适配器
- [ ] 实现Google适配器
- [ ] 实现Custom适配器
- [ ] 添加适配器自动选择逻辑

---

### **阶段3: 高级功能集成 (中等复杂度，1-2周)**

#### **3.1 AI润色集成** ⭐⭐⭐ (3-4天)
**复杂度**: 中等 - 需要理解现有AI系统
**风险**: 低 - 复用现有功能
**依赖**: 阶段2.2

- [ ] 分析现有AI后处理系统
- [ ] 实现远程转录的润色调度
- [ ] 添加润色配置选项
- [ ] 集成润色结果到历史记录

#### **3.2 前端增强功能** ⭐⭐ (2-3天)
**复杂度**: 低 - UI/UX改进
**风险**: 低 - 前端修改
**依赖**: 阶段1.3

- [ ] 实现转录状态的可视化显示
- [ ] 添加手动编辑功能
- [ ] 实现结果预览和确认
- [ ] 添加错误状态的用户提示

---

### **阶段4: 测试和优化 (低复杂度，1周)**

#### **4.1 集成测试** ⭐⭐⭐ (3-4天)
**复杂度**: 中等 - 需要测试各种场景
**风险**: 低 - 测试阶段
**依赖**: 所有前序阶段

- [ ] 单元测试各个组件
- [ ] 集成测试完整流程
- [ ] 网络异常场景测试
- [ ] API兼容性测试

#### **4.2 性能优化和文档** ⭐⭐ (2-3天)
**复杂度**: 低 - 优化和文档
**风险**: 低 - 收尾工作

- [ ] 性能监控和优化
- [ ] 用户文档更新
- [ ] 错误处理完善
- [ ] 代码清理和注释

---

## 🔄 **并行开发路线图**

### **路线A: 配置和UI并行** (推荐)
```
Week 1: 1.1 + 1.3 并行开发
Week 2: 1.2 + 2.3 并行开发
Week 3: 2.1 + 2.2 串行开发
Week 4: 3.1 + 3.2 并行开发
Week 5: 4.1 + 4.2 并行开发
```

### **路线B: 功能驱动并行**
```
核心路径: 1.1 → 1.2 → 2.1 → 2.2 → 3.1 → 4.1
并行路径: 1.3 → 2.3 → 3.2 → 4.2
```

**总计**: 21-27个工作日 (+7-9天)

---

## 🔧 关键技术细节

### 异步转录实现

#### 远程API调用
```rust
impl RemoteTranscriptionClient {
    pub async fn transcribe_audio(&self, audio_path: &Path, config: &ApiConfig) -> Result<String> {
        // 读取音频文件
        let audio_data = tokio::fs::read(audio_path).await?;

        // 构建multipart请求
        let form = reqwest::multipart::Form::new()
            .part("audio", reqwest::multipart::Part::bytes(audio_data)
                .file_name("audio.wav")
                .mime_str("audio/wav")?);

        // 发送请求并获取完整结果
        let response = self.client
            .post(&config.endpoint)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .multipart(form)
            .timeout(Duration::from_secs(config.timeout_seconds))
            .send()
            .await?;

        // 解析响应
        let result: serde_json::Value = response.json().await?;
        let transcription = result["text"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("Invalid API response"))?;

        Ok(transcription.to_string())
    }
}
```

#### 前端状态管理
```typescript
// 异步转录状态管理
const [transcriptionState, setTranscriptionState] = useState({
  historyId: null,
  status: 'idle', // 'idle' | 'transcribing' | 'completed' | 'failed'
  text: '',
  isEditing: false,
});
```

### AI润色集成

#### 自动润色流程
```rust
impl TranscriptionManager {
    pub fn schedule_auto_polish(&self, history_id: i64) {
        let self_clone = self.clone();
        tokio::spawn(async move {
            // 等待转录完成
            self_clone.wait_for_transcription_complete(history_id).await;

            // 获取转录结果
            let entry = self_clone.history_manager.get_entry_by_id(history_id).await?;
            if let Some(text) = entry.transcription_text {
                // 执行润色
                if let Ok(polished) = self_clone.polish_transcription(history_id, &text).await {
                    // 更新最终结果
                    self_clone.update_history_final_text(history_id, &polished).await?;
                }
            }
        });
    }
}
```

---

## ⚠️ 风险评估 (更新)

### 新增风险

1. **网络稳定性**: 远程API调用可能因网络问题失败
   - **缓解**: 实现重试机制和超时处理

2. **API兼容性**: 不同服务商的API格式可能不同
   - **缓解**: 设计灵活的配置系统和错误处理

3. **并发控制**: 多个异步任务可能导致资源竞争
   - **缓解**: 实现任务队列和资源限制

### 业务风险

1. **服务可用性**: 依赖外部服务的可用性
   - **缓解**: 本地模式作为fallback，提供离线能力

2. **成本控制**: API调用可能产生费用
   - **缓解**: 使用量监控和用户提醒

3. **隐私保护**: 音频数据上传到第三方服务
   - **缓解**: 明确的用户同意和隐私声明

---

## 📈 成功指标 (更新)

### 新增功能指标
- [ ] 远程转录成功率 > 95%
- [ ] AI润色成功率 > 90%
- [ ] 网络超时处理成功率 > 95%

### 用户体验指标
- [ ] 录制到保存延迟 < 500ms
- [ ] 转录完成通知延迟 < 2秒
- [ ] 润色完成时间 < 3秒

---

## 🔄 新需求: Prompt管理系统优化

### 需求背景
用户希望能够更好地管理AI润色prompt：
1. 通过开关快速集成系统预设的prompt组件
2. 提供多种prompt选项，支持用户自定义修改
3. 点击开关后自动将选中的组件组合成完整prompt

### 设计方案

#### 1. 模块化Prompt组件系统
```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PromptComponent {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: PromptCategory,
    pub template: String,        // 组件模板
    pub enabled: bool,          // 是否启用
    pub order: u32,             // 组合顺序
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub enum PromptCategory {
    Formatting,    // 格式化 (标点、数字转换等)
    Style,         // 风格 (正式、口语化等)
    Language,      // 语言 (翻译、语法检查等)
    Content,       // 内容 (摘要、扩展等)
    Custom,        // 自定义
}
```

#### 2. 系统预设组件库
- **格式化组件**: 标点修复、数字转换、大小写修正
- **风格组件**: 正式化表达、去除填充词、语气调整
- **语言组件**: 语法检查、多语言支持、翻译
- **内容组件**: 摘要生成、要点提取、内容扩展

#### 3. 动态Prompt组合逻辑
```rust
impl AppSettings {
    pub fn build_combined_prompt(&self, selected_components: &[String]) -> String {
        // 智能组合选中的组件
        // 生成最终的完整prompt
    }
}
```

#### 4. 前端交互界面
- 分类展示prompt组件
- 开关式快速启用/禁用
- 实时预览组合后的完整prompt
- 保存常用组合配置

### 实施计划
- **Phase 1**: 基础组件系统 (3-4天)
- **Phase 2**: 前端交互界面 (4-5天)
- **Phase 3**: 组合逻辑实现 (2-3天)

**总计**: 约10-12个工作日

---

## 🔄 后续扩展

### Phase 1扩展 (短期)
- 支持更多远程API服务商
- 自定义润色prompt模板
- 转录结果版本历史

### Phase 2扩展 (中期)
- 多人协作转录
- 转录结果对比分析
- 自定义润色工作流

### Phase 3扩展 (长期)
- 实时语音翻译
- 多语言混杂识别
- AI辅助内容生成

---

## 📝 总结

优化后的远程API转录功能设计：

1. **完全兼容现有AI系统**: 直接复用已有的AI后处理功能
2. **异步转录架构**: 录制即保存，后台异步处理
3. **状态显示优化**: 前端显示转录进度，支持手动编辑
4. **架构灵活**: 可以根据远程API能力选择不同的实现方式

**关键优势**:
- **零架构改动**: 完全兼容现有设计
- **功能完整**: 涵盖异步转录 + AI润色 + 手动编辑
- **用户体验优秀**: 从录制到最终插入的完整工作流
- **扩展性强**: 为未来高级功能奠定基础

---

**文档版本**: v1.1
**最后更新**: 2025-11-10
**状态**: 设计优化完成，准备实施
