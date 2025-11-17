# 模型缓存和Online ASR功能设计文档

## 📋 文档概述

本文档记录了为Handy项目添加模型缓存系统和Online ASR功能的完整设计方案。该功能允许用户从LLM API获取模型列表，进行缓存管理，并支持Online ASR转录模式。

**创建时间**: 2025-11-10
**设计者**: AI Assistant
**状态**: 实施中

---

## 🎯 项目背景

### 当前PostProcess系统

Handy已有完整的AI后处理系统：
- 支持OpenAI、Anthropic等多种provider
- 自定义prompt模板
- 后处理结果存储在历史记录中

### 新需求分析

用户希望增强模型选择功能：
1. **模型缓存列表**：从LLM API获取模型，选择后添加到缓存
2. **模型类型设置**：手动标记模型类型（Text/ASR，默认Text）
3. **Online ASR开关**：二选一模式，启用远程ASR或本地Whisper
4. **Prompt模型选择**：在AI后处理中选择Text类型的缓存模型

---

## 🏗️ 设计方案

### 核心设计理念

**在现有PostProcess系统基础上扩展**：
- 复用现有的`fetchPostProcessModels`获取模型列表
- 添加模型缓存和类型管理
- 实现Online ASR与本地转录的二选一逻辑
- 扩展Prompt设置支持模型选择

### 数据结构扩展

#### 后端数据结构 (settings.rs)

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CachedModel {
    pub id: String,
    pub name: String,
    pub model_type: ModelType,
    pub provider_id: String,
    pub model_id: String,
    pub added_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub enum ModelType {
    Text,      // 默认类型，用于文本处理和对话
    Asr,       // 语音识别（需要手动设置）
    Other,     // 其他类型
}

// 在AppSettings中添加
pub cached_models: Vec<CachedModel>,
pub online_asr_enabled: bool,
pub selected_asr_model_id: Option<String>,
pub selected_prompt_model_id: Option<String>,
```

#### 前端类型定义 (types.ts)

```typescript
export const ModelTypeSchema = z.enum(["text", "asr", "other"]);
export type ModelType = z.infer<typeof ModelTypeSchema>;

export const CachedModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  model_type: ModelTypeSchema,
  provider_id: z.string(),
  model_id: z.string(),
  added_at: z.string(),
});

export type CachedModel = z.infer<typeof CachedModelSchema>;

// 扩展SettingsSchema
cached_models: z.array(CachedModelSchema).optional().default([]),
online_asr_enabled: z.boolean().optional().default(false),
selected_asr_model_id: z.string().nullable().optional(),
selected_prompt_model_id: z.string().nullable().optional(),
```

---

## 📁 技术实现方案

### Phase 1: 数据结构扩展 (1-2天)

#### 1.1 后端数据结构扩展

- 添加`CachedModel`和`ModelType`结构体
- 在`AppSettings`中添加新字段
- 更新默认设置函数

#### 1.2 前端类型定义扩展

- 添加新的Zod schemas
- 扩展`SettingsSchema`
- 更新类型导出

#### 1.3 存储同步逻辑

- 扩展settings store添加新字段处理
- 添加缓存模型的增删改API

### Phase 2: 模型缓存管理UI (2-3天)

#### 2.1 ModelCacheManager组件

```typescript
// src/components/settings/post-processing/ModelCacheManager.tsx
interface ModelCacheManagerProps {
  cachedModels: CachedModel[];
  availableModels: string[];
  onAddModel: (modelId: string, modelType: ModelType) => void;
  onUpdateModelType: (modelId: string, modelType: ModelType) => void;
  onRemoveModel: (modelId: string) => void;
}
```

#### 2.2 模型获取和缓存逻辑

- 复用现有的`fetchPostProcessModels`
- 添加"添加到缓存"功能
- 支持设置模型类型（Text/ASR）

### Phase 3: Online ASR开关 (1-2天)

#### 3.1 OnlineAsrToggle组件

```typescript
// src/components/settings/post-processing/OnlineAsrToggle.tsx
interface OnlineAsrToggleProps {
  enabled: boolean;
  selectedModelId: string | null;
  availableAsrModels: CachedModel[];
  onToggle: (enabled: boolean) => void;
  onModelSelect: (modelId: string) => void;
}
```

#### 3.2 转录流程集成

- 修改转录管理器支持Online ASR
- 当启用Online ASR时，使用选中的ASR模型
- 当禁用时，使用本地Whisper模型

### Phase 4: Prompt模型选择 (1-2天)

#### 4.1 扩展Prompt设置

- 在PostProcessingSettingsPrompts中添加模型选择
- 只显示Text类型的缓存模型
- 支持在prompt模板中使用选中的模型

---

## 🔄 实施计划

### **阶段1: 基础设施搭建 (2-3天)**

#### **1.1 数据结构扩展** ⭐⭐ (1天)
**复杂度**: 低 - 主要是类型定义和数据结构
**风险**: 低 - 不影响现有功能

- [ ] 扩展`settings.rs`添加`CachedModel`和`ModelType`
- [ ] 更新`AppSettings`结构体
- [ ] 修改默认设置函数
- [ ] 扩展`types.ts`添加新的Zod schemas
- [ ] 更新`SettingsSchema`

#### **1.2 存储和API扩展** ⭐⭐ (1天)
**复杂度**: 中等 - 需要扩展settings store
**风险**: 低 - 扩展现有逻辑

- [ ] 扩展settingsStore添加缓存模型管理
- [ ] 添加Tauri commands处理缓存模型CRUD
- [ ] 更新useSettings hook

### **阶段2: 核心功能实现 (3-4天)**

#### **2.1 模型缓存管理UI** ⭐⭐⭐ (2天)
**复杂度**: 中等 - 需要新UI组件
**风险**: 低 - 新增功能

- [ ] 创建`ModelCacheManager`组件
- [ ] 实现模型列表显示和管理
- [ ] 添加模型类型设置功能
- [ ] 集成到PostProcessingSettings

#### **2.2 Online ASR开关** ⭐⭐⭐ (1-2天)
**复杂度**: 中等 - 需要修改转录逻辑
**风险**: 中等 - 影响转录流程

- [ ] 创建`OnlineAsrToggle`组件
- [ ] 修改转录管理器支持Online ASR
- [ ] 实现ASR模型选择逻辑

### **阶段3: 高级功能集成 (2-3天)**

#### **3.1 Prompt模型选择** ⭐⭐ (1天)
**复杂度**: 低 - 扩展现有组件
**风险**: 低 - UI层面修改

- [ ] 扩展PostProcessingSettingsPrompts
- [ ] 添加模型选择下拉框
- [ ] 实现模型过滤（只显示Text类型）

#### **3.2 集成测试和优化** ⭐⭐ (1-2天)
**复杂度**: 中等 - 测试各种场景
**风险**: 低 - 测试阶段

- [ ] 测试模型缓存功能
- [ ] 测试Online ASR切换
- [ ] 测试Prompt模型选择
- [ ] 修复发现的问题

---

## 🔧 关键技术细节

### 模型缓存管理

#### 添加模型到缓存
```typescript
const handleAddModel = async (modelId: string, modelType: ModelType) => {
  const newCachedModel: CachedModel = {
    id: generateId(),
    name: modelId,
    model_type: modelType,
    provider_id: selectedProviderId,
    model_id: modelId,
    added_at: new Date().toISOString(),
  };

  await invoke('add_cached_model', { model: newCachedModel });
  await refreshSettings();
};
```

#### Online ASR转录流程
```rust
impl TranscriptionManager {
    pub async fn transcribe(&self, audio_data: &[f32]) -> Result<String> {
        let settings = get_settings(&self.app_handle);

        if settings.online_asr_enabled {
            // 使用Online ASR
            if let Some(asr_model_id) = &settings.selected_asr_model_id {
                return self.transcribe_with_online_asr(audio_data, asr_model_id).await;
            }
        }

        // 使用本地Whisper
        self.transcribe_with_whisper(audio_data).await
    }
}
```

### Prompt模型集成

#### 动态模型选择
```typescript
const selectedModel = cachedModels.find(m => m.id === selectedPromptModelId);
const promptWithModel = promptTemplate.replace('${model}', selectedModel?.model_id || 'gpt-3.5-turbo');
```

---

## ⚠️ 风险评估

### 技术风险

1. **数据迁移**: 添加新字段到现有设置
   - **缓解**: 使用Option类型，默认值为None

2. **转录流程修改**: Online ASR与本地转录的切换
   - **缓解**: 保持向后兼容，Online ASR作为可选功能

3. **API依赖**: 依赖外部LLM API的可用性
   - **缓解**: 本地转录作为fallback

### 业务风险

1. **用户体验**: 复杂的模型管理界面
   - **缓解**: 提供清晰的UI引导和默认设置

2. **性能影响**: Online ASR可能增加延迟
   - **缓解**: 显示加载状态，允许取消操作

---

## 📈 成功指标

### 功能指标
- [ ] 模型缓存功能正常工作
- [ ] Online ASR开关正确切换转录模式
- [ ] Prompt模型选择正常工作
- [ ] 设置持久化正确保存

### 用户体验指标
- [ ] 模型添加流程简单直观
- [ ] ASR模式切换响应迅速
- [ ] 界面布局合理，无拥挤感

---

## 🔄 后续扩展

### Phase 2扩展 (中期)
- 支持更多模型类型
- 模型使用统计和推荐
- 批量模型管理

### Phase 3扩展 (长期)
- 模型性能对比
- 自动模型类型检测
- 云端模型同步

---

## 📝 总结

这个功能在现有PostProcess系统基础上进行最小化扩展：

1. **数据结构扩展**: 添加模型缓存和ASR相关字段
2. **UI组件扩展**: 新增模型管理和ASR开关组件
3. **逻辑集成**: 在转录和Prompt系统中集成新功能
4. **向后兼容**: 保持现有功能完全不变

**关键优势**:
- **最小化改动**: 在现有架构基础上扩展
- **功能完整**: 涵盖模型缓存、类型管理、Online ASR
- **用户友好**: 直观的UI和清晰的工作流程
- **可扩展性**: 为未来高级功能奠定基础

---

**文档版本**: v1.0
**最后更新**: 2025-11-10
**状态**: 实施中

