# Votype 优化快速启动指南

## 🎯 核心目标

将 Votype 升级为**上下文感知的智能输入助手**

## 📊 关键指标

| 维度       | 当前   | 目标     |
| ---------- | ------ | -------- |
| 功能模式   | 单一   | 8+ Skill |
| 上下文感知 | 基础   | 丰富     |
| 用户体验   | 功能性 | 场景化   |

## ⚡ 快速决策参考

### 我应该先做什么？

**Week 1-2: Skill 系统基础**

```bash
# 1. 创建 Skill 数据结构
src-tauri/src/skills/
├── mod.rs           # Skill 定义
├── manager.rs       # Skill 管理器
└── executor.rs      # Skill 执行器

# 2. 创建 3 个基础 Skill
src-tauri/resources/skills/builtin/
├── smart_compose.skill.md
├── translation.skill.md
└── grammar_fix.skill.md
```

### Skill vs 现有提示词系统？

**迁移策略**:

```
现有提示词 → Skill 系统
├── system_text_optimization.md → smart_compose.skill.md
├── system_skill_generation.md  → code_generate.skill.md (新)
└── 其他 → 逐步迁移
```

**共存方式**:

- Phase 1-2: 两套系统共存
- Phase 3: 逐步迁移到 Skill
- Phase 4: 废弃旧系统

### 上下文采集的优先级？

**必须实现** (Week 2):

- ✅ 当前应用 bundle_id
- ✅ 当前应用名称
- ✅ 应用类型推断

**可选实现** (Week 3-4):

- ⚠️ 窗口标题（需要额外权限）
- ⚠️ 光标上下文（实现复杂）
- ⚠️ 选中文本（实现复杂）

**降级方案**:

```rust
// 如果无法获取上下文，优雅降级
if context.focused_app.is_none() {
    // 使用默认 Skill
    return default_skill;
}
```

## 📝 实施检查清单

### Phase 1: 基础架构 (Week 1-2)

#### Week 1 任务

- [ ] 创建 `src-tauri/src/skills/mod.rs`
  - [ ] 定义 `Skill` 结构
  - [ ] 定义 `SkillMetadata` 结构
  - [ ] 实现 `Skill::from_file()`
  - [ ] 实现 `Skill::render()`
- [ ] 创建 `src-tauri/src/skills/manager.rs`
  - [ ] 实现 `SkillManager::new()`
  - [ ] 实现 `load_all()`
  - [ ] 实现 `get_skill()`
- [ ] 添加依赖到 `Cargo.toml`
  ```toml
  handlebars = "4.5"
  serde_yaml = "0.9"
  ```
- [ ] 创建 3 个基础 Skill 文件
- [ ] 编写单元测试

**验收**: `cargo test --package votype --lib skills`

#### Week 2 任务

- [ ] 创建 `src-tauri/src/context/mod.rs`
  - [ ] 扩展 `AudioContext` 结构
  - [ ] 定义 `AppInfo` 结构
  - [ ] 实现 `AppCategory` 枚举
- [ ] 创建 `src-tauri/src/context/collector.rs`
  - [ ] 实现 `get_focused_app()`
  - [ ] 实现应用类型推断
- [ ] 集成到录音流程
- [ ] 编写集成测试

**验收**: 能在不同应用中正确识别应用类型

### Phase 2: 执行引擎 (Week 3-4)

#### Week 3 任务

- [ ] 创建 `src-tauri/src/skills/executor.rs`
  - [ ] 实现 `SkillExecutor::execute()`
  - [ ] 实现 `auto_select_skill()`
  - [ ] 实现命令检测
- [ ] 集成到 `post_process/routing.rs`
- [ ] 添加模型偏好支持

**验收**: 能根据应用自动选择并执行 Skill

#### Week 4 任务

- [ ] 创建 5 个新 Skill:
  - [ ] `summarize.skill.md`
  - [ ] `code_generate.skill.md`
  - [ ] `code_explain.skill.md`
  - [ ] `memo.skill.md`
  - [ ] `reply_suggestion.skill.md`
- [ ] 为每个 Skill 编写示例
- [ ] 实际使用测试

**验收**: 8 个高质量 Skill 完整可用

### Phase 3: 用户界面 (Week 5-6)

#### Week 5 任务

- [ ] 创建 Skill 列表组件
- [ ] 创建 Skill 卡片组件
- [ ] 添加托盘菜单 Skill 快速切换
- [ ] 实现录音 Skill 指示器

**验收**: 用户能看到和切换 Skill

#### Week 6 任务

- [ ] 实现 Skill 编辑器
- [ ] 实现 Skill 创建向导
- [ ] 实现导入/导出功能

**验收**: 用户能创建和编辑 Skill

## 🚀 快速代码片段

### 创建一个新 Skill

```markdown
---
id: "my_skill"
name: "我的技能"
description: "做一些很酷的事情"
icon: "✨"
category: "实用工具"
context_requires:
  - user_language
  - current_app
model_preference: "balanced"
enabled: true
---

用户语言: {{context.user_language}}
当前应用: {{context.current_app}}

# Role

你是一个[角色描述]

# Constraints

1. 直接输出结果，不要解释
2. 不要客套话
3. [其他约束]

# Examples

## Example 1

Input: "示例输入"
Output: "示例输出"
```

### 测试 Skill 加载

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_skill() {
        let skill = Skill::from_file(Path::new("resources/skills/builtin/smart_compose.skill.md"))
            .expect("Failed to load skill");

        assert_eq!(skill.metadata.id, "smart_compose");
        assert_eq!(skill.metadata.name, "智能续写");
    }

    #[test]
    fn test_render_skill() {
        let skill = Skill::from_file(Path::new("resources/skills/builtin/smart_compose.skill.md"))
            .expect("Failed to load skill");

        let context = SkillContext {
            user_language: "zh-CN".to_string(),
            current_app: "Visual Studio Code".to_string(),
            app_category: "CodeEditor".to_string(),
            ..Default::default()
        };

        let rendered = skill.render(&context).expect("Failed to render");
        assert!(rendered.contains("Visual Studio Code"));
    }
}
```

### 集成到后处理管道

```rust
// src-tauri/src/actions/post_process/routing.rs

pub async fn process_with_skill(
    transcript: &str,
    audio_context: &AudioContext,
) -> Result<String> {
    let skill_manager = SkillManager::get_instance();
    let skill_executor = SkillExecutor::new(skill_manager);

    // 1. 检测显式命令
    if let Some(skill_id) = detect_skill_command(transcript) {
        return skill_executor.execute(&skill_id, transcript).await;
    }

    // 2. 自动选择
    if let Some(skill_id) = skill_executor.auto_select_skill(audio_context).await {
        return skill_executor.execute(&skill_id, transcript).await;
    }

    // 3. 默认
    skill_executor.execute("smart_compose", transcript).await
}
```

## 🐛 常见问题

### Q1: Skill 加载失败？

**检查**:

1. YAML frontmatter 格式是否正确？
2. 文件是否在正确的目录？
3. 文件扩展名是否为 `.skill.md`？

**调试**:

```bash
# 查看详细错误
RUST_LOG=debug cargo run
```

### Q2: 上下文采集失败？

**检查**:

1. 是否授予了 Accessibility 权限？
2. 当前应用是否在黑名单中？

**降级处理**:

```rust
let context = context_collector.collect().await.unwrap_or_default();
```

### Q3: 提示词变量未替换？

**检查**:

1. 变量名是否正确？（`{{context.xxx}}` 而不是 `{{xxx}}`）
2. Handlebars 是否正确初始化？

**测试**:

```rust
let template = "Hello {{context.name}}";
let data = json!({"context": {"name": "World"}});
let result = handlebars.render_template(template, &data)?;
assert_eq!(result, "Hello World");
```

## 📚 进一步阅读

- [完整优化方案](./OPTIMIZATION_PLAN.md)
- [Skill 开发指南](./SKILL_DEVELOPMENT_GUIDE.md) (待创建)
- [上下文采集文档](./CONTEXT_COLLECTION.md) (待创建)

## 💡 下一步

1. 阅读 [OPTIMIZATION_PLAN.md](./OPTIMIZATION_PLAN.md) 了解完整方案
2. 开始 Phase 1 Week 1 的任务
3. 遇到问题查看常见问题或提 Issue

---

**记住**: 渐进增强，不破坏现有功能！
