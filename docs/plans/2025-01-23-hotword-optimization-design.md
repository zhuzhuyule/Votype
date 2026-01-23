# 热词系统优化设计方案

## 概述

优化 Votype 的热词能力，解决以下痛点：

- 上下文感知不足 - 热词不能根据场景自动切换
- LLM 注入效果有限 - 注入了但 LLM 不一定正确应用
- 误触率高 - 同音/近音误触、语义不相关误触、部分匹配误触

## 解决方案

采用 **强化 LLM 层** 策略，核心改进：

1. 热词分类体系 - 按语义类型和使用场景分类
2. 结构化 LLM 注入 - 提供丰富的分类和判断依据
3. 智能筛选 - 根据上下文动态选择热词
4. 误触反馈机制 - 持续优化热词效果

---

## 一、热词数据模型

### 新模型

```typescript
interface Hotword {
  id: string;
  original: string[]; // 可能的错误识别形式（可多个）
  target: string; // 目标正确形式

  // 分类信息
  category: HotwordCategory; // person | term | brand | abbreviation
  scenarios: HotwordScenario[]; // work | casual（可多选）

  // 元数据
  confidence: number; // 自动推断的置信度 0-1
  userOverride: boolean; // 用户是否手动修改过分类

  // 统计
  useCount: number; // 使用次数
  lastUsedAt: number; // 最后使用时间
  falsePositiveCount: number; // 误触次数
}

type HotwordCategory = "person" | "term" | "brand" | "abbreviation";
type HotwordScenario = "work" | "casual";
```

### 分类说明

**语义类型 (HotwordCategory):**

- `person` - 人名（同事、朋友、公众人物）
- `term` - 专业术语（技术词汇、行业术语）
- `brand` - 产品/品牌名（公司名、产品名、项目名）
- `abbreviation` - 缩写/简称（API、SDK、CEO 等）

**使用场景 (HotwordScenario):**

- `work` - 工作场景（会议、文档、代码）
- `casual` - 日常交流（聊天、备忘）

### 自动推断规则

```typescript
function inferCategory(target: string): {
  category: HotwordCategory;
  confidence: number;
} {
  // 全大写 2-5 字符 → abbreviation
  if (/^[A-Z]{2,5}$/.test(target)) {
    return { category: "abbreviation", confidence: 0.9 };
  }

  // 含技术后缀 → term
  if (/(-js|-ts|-api|Config|Manager|Service|Handler)$/i.test(target)) {
    return { category: "term", confidence: 0.8 };
  }

  // 首字母大写单词 → person 或 brand（需 LLM 辅助）
  if (/^[A-Z][a-z]+$/.test(target)) {
    return { category: "person", confidence: 0.5 }; // 低置信度，建议用户确认
  }

  // 默认
  return { category: "term", confidence: 0.3 };
}
```

---

## 二、LLM 注入策略

### 结构化格式

```markdown
## 词汇修正指引

### 人名 (person)

当对话涉及人物时考虑：

- "cloud/claud" → "Claude" [工作场景]
- "张三/章三" → "张珊" [日常交流]

### 专业术语 (term)

技术讨论中考虑：

- "泰瑞/tauri" → "Tauri" [工作场景]
- "reduct/reducer" → "Redux" [工作场景]

### 品牌/产品 (brand)

提及产品或公司时考虑：

- "anthropic/安卓匹克" → "Anthropic" [工作场景]

### 缩写 (abbreviation)

通常直接替换：

- "api/啊皮埃" → "API"
- "sdk" → "SDK"

## 替换判断规则

对于每个可能的替换，请判断：

1. **语义相关性** - 原词在当前语境中是否指向目标概念？
   - ✓ "我要问一下 cloud" (谈论人) → Claude
   - ✗ "deploy to cloud" (谈论云服务) → 保持 cloud

2. **场景匹配** - 热词标记的场景是否与当前场景一致？
   - 当前是工作场景，优先考虑标记为"工作"的热词

3. **置信度要求** - 不确定时保守处理，保留原词
```

### 智能筛选

**筛选逻辑：**

1. 场景匹配 - 根据当前应用判断场景
2. 近期活跃 - 优先选择最近 7 天使用过的热词
3. 低误触率 - 降低 `falsePositiveCount` 高的热词优先级
4. 动态数量 - 根据热词总量动态调整

**分层策略：**

- **核心层（始终注入）**：高频 + 低误触 + 场景匹配，最多 10 个
- **扩展层（按需注入）**：中频或跨场景，最多 15 个
- **长尾层（仅提及）**：低频词仅在系统提示中说明"用户还有其他自定义词汇，如有疑问可保守处理"

---

## 三、热词管理界面

### 列表视图

```
┌─────────────────────────────────────────────────────────────┐
│  热词管理                                    [+ 添加] [导入]  │
├─────────────────────────────────────────────────────────────┤
│  筛选: [全部 ▼] [人名] [术语] [品牌] [缩写]    搜索: [____]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  👤 人名                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ "claud/cloud" → Claude          工作  使用 23 次  ⋮  │   │
│  │ "张三" → 张珊                    日常  使用 12 次  ⋮  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  🔧 专业术语                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ "泰瑞/tauri" → Tauri            工作  使用 45 次  ⋮  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 单个添加

```
┌────────────────────────────────────┐
│  添加热词                      ✕   │
├────────────────────────────────────┤
│  目标词: [Anthropic         ]      │
│                                    │
│  可能的错误识别（可选，逗号分隔）:   │
│  [anthropic, 安卓匹克, 安索匹克]   │
│                                    │
│  分类: (●) 品牌  ← 自动推断        │
│        ( ) 人名                    │
│        ( ) 术语                    │
│        ( ) 缩写                    │
│                                    │
│  场景: [✓] 工作  [ ] 日常          │
│                                    │
│         [取消]  [添加]             │
└────────────────────────────────────┘
```

### 批量添加

```
┌────────────────────────────────────┐
│  批量添加                      ✕   │
├────────────────────────────────────┤
│  每行一个热词，格式：目标词         │
│  （分类将自动推断，可稍后编辑）     │
│  ┌──────────────────────────────┐ │
│  │ Claude                       │ │
│  │ Tauri                        │ │
│  │ Anthropic                    │ │
│  └──────────────────────────────┘ │
│                                    │
│  预览: 3 个热词                    │
│  - Claude → 👤 人名 (推断)         │
│  - Tauri → 🔧 术语 (推断)          │
│  - Anthropic → 🏢 品牌 (推断)      │
│                                    │
│         [取消]  [添加全部]         │
└────────────────────────────────────┘
```

### 导入/导出

**导出格式（JSON）：**

```json
{
  "version": "2.0",
  "exportedAt": "2025-01-23T...",
  "hotwords": [
    {
      "target": "Claude",
      "originals": ["claud", "cloud"],
      "category": "person",
      "scenarios": ["work"]
    }
  ]
}
```

**导入流程：**

1. 选择 JSON 文件
2. 预览导入内容，显示冲突项
3. 选择冲突处理方式：跳过 / 覆盖 / 合并
4. 确认导入

---

## 四、上下文感知

### 场景自动识别

```typescript
const appScenarioMap: Record<string, HotwordScenario> = {
  // 工作场景
  Code: "work",
  VSCode: "work",
  Cursor: "work",
  Terminal: "work",
  Slack: "work",
  Notion: "work",
  Figma: "work",

  // 日常场景
  WeChat: "casual",
  Messages: "casual",
  Telegram: "casual",
  WhatsApp: "casual",

  // 未配置的应用：两种场景都考虑
};
```

用户可在设置中自定义应用与场景的关联。

### 上下文注入

```markdown
## 当前上下文

- 应用: Visual Studio Code
- 场景: 工作
- 窗口标题: "main.rs - votype"
```

---

## 五、误触反馈机制

### 收集误触信号

1. **显式反馈** - 用户在审核窗口点击"撤销此替换"
2. **隐式反馈** - 用户在历史记录中把替换改回原词
3. **快速撤销** - 粘贴后 5 秒内 Cmd+Z 撤销

### 反馈处理

```typescript
if (hotword.falsePositiveCount >= 3) {
  // 降低该热词在 LLM 注入中的优先级
  hotword.priority = "low";
}

if (hotword.falsePositiveCount >= 5) {
  // 提示用户：该热词误触率较高，是否调整？
  suggestActions: ["添加更精确的原词形式", "限制到特定场景", "暂时禁用"];
}
```

---

## 六、数据流

```
转录完成
    │
    ▼
1. 获取当前上下文
   - 当前应用 → 场景识别 (work/casual)
   - 窗口标题 → 额外上下文
    │
    ▼
2. 智能筛选热词
   - 场景匹配筛选
   - 按活跃度 + 误触率排序
   - 分层：核心层(10) + 扩展层(15) + 长尾提示
    │
    ▼
3. 构建结构化 LLM 提示
   - 按分类组织热词
   - 注入判断规则
   - 附加上下文信息
    │
    ▼
4. LLM 处理
   - 语义理解 + 上下文判断
   - 输出替换决策
    │
    ▼
5. 后处理 & 反馈收集
   - 应用替换
   - 监听用户撤销/修改 → 更新误触计数
```

---

## 七、实现计划

### 涉及的文件

| 模块       | 文件                                               | 改动                                |
| ---------- | -------------------------------------------------- | ----------------------------------- |
| 数据模型   | `src-tauri/src/settings.rs`                        | 移除 `custom_words`，新增 `Hotword` |
| 数据库     | `src-tauri/src/managers/vocabulary.rs`             | 新增 `hotwords` 表                  |
| 旧代码清理 | `src-tauri/src/audio_toolkit/text.rs`              | 移除 `apply_custom_words()`         |
| 旧 UI 清理 | `src/components/settings/VocabularySettings.tsx`   | 移除旧热词部分                      |
| 分类推断   | `src-tauri/src/managers/hotword.rs` (新)           | 自动分类逻辑                        |
| LLM 注入   | `src-tauri/src/actions/post_process.rs`            | 重构热词注入策略                    |
| 场景识别   | `src-tauri/src/managers/app_context.rs` (新)       | 应用→场景映射                       |
| 前端 UI    | `src/components/settings/HotwordSettings.tsx` (新) | 热词管理界面                        |
| 导入导出   | `src-tauri/src/commands/hotword.rs` (新)           | 导入导出命令                        |

### 优先级

**P0 - 核心功能：**

- 新数据模型 + 数据库
- 结构化 LLM 注入
- 基础管理界面（列表、添加、编辑）

**P1 - 体验优化：**

- 自动分类推断
- 场景识别 + 智能筛选
- 批量添加 + 导入导出

**P2 - 闭环迭代：**

- 误触反馈机制
- 误触率统计 + 建议优化
- 应用-场景自定义映射

---

## 八、不做的事项

- 不兼容旧 `custom_words` 数据，直接替换
- 不做 ASR 层面的 hotword biasing（需要模型支持）
- 不做规则层的模糊匹配优化（完全依赖 LLM 判断）
