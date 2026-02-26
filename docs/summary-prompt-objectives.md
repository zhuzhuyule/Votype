# Summary 拆分 Prompt 目标与任务说明

## 环境上下文

- 项目：Votype（本地离线语音转写 + AI 后处理）
- 技术栈：Tauri v2 (Rust) + React/TypeScript + Radix UI Themes
- 当前分析模式：支持「整合请求」与「拆分请求」两种模式
- 拆分请求：按不同目标拆分为多个 prompt，分别调用 LLM，再合并结果
- 关键输出：JSON 结构化结果，供 Summary 页面解析展示

## 文档目的

- 将当前拆分 prompt 按文件列出
- 明确每个文件用于实现的功能目标
- 提供该 prompt 需要完成的具体任务清单（任务粒度要求）

---

## 日报（day）拆分 prompts

### 1) system_summary_day_summary.md

- 功能目标：生成当天整体概览，为用户提供快速回顾
- 任务要求：
  - 概括当天主要活动与关注点
  - 强调成果/推进而非流水账
  - 输出 JSON：{ summary: { title, content } }

### 2) system_summary_day_activities.md

- 功能目标：还原当天活动时间线，便于定位“何时做了什么”
- 任务要求：
  - 按上午/下午/晚上拆分
  - 抽象活动类别与场景
  - 输出 JSON：{ activities: { title, items } }

### 3) system_summary_day_highlights.md

- 功能目标：提炼当天关键事项（决策、突破、成果）
- 任务要求：
  - 只保留最重要的事项
  - 避免重复活动细节
  - 输出 JSON：{ highlights: { title, items } }

### 4) system_summary_day_todos.md

- 功能目标：提取待办事项，形成可确认清单
- 任务要求：
  - 仅提取明确待办，不判断完成度
  - items 为对象数组：{ id, text, status="unknown" }
  - 输出 JSON：{ todos_extracted: { title, items } }

### 5) system_summary_day_vocab.md

- 功能目标：提取当天新词/专有名词，辅助词库与纠错
- 任务要求：
  - 关注术语、项目名、人名、工具名
  - 输出 JSON：{ vocabulary_extracted: { title, items } }

### 6) system_summary_day_focus.md

- 功能目标：评估当天专注度，用于自我反思与趋势对比
- 任务要求：
  - 综合上下文切换与活动连续性
  - score 0-10 整数
  - 输出 JSON：{ focus_assessment: { title, score, comment } }

---

## 周报（week）拆分 prompts

### 1) system_summary_week_summary.md

- 功能目标：概括一周整体成果与状态
- 任务要求：
  - 强调方向与结果
  - 输出 JSON：{ summary: { title, content } }

### 2) system_summary_week_work_focus.md

- 功能目标：总结一周工作重心（项目/领域）
- 任务要求：
  - 列出 2-3 个重点领域
  - 输出 JSON：{ work_focus: { title, items } }

### 3) system_summary_week_activities.md

- 功能目标：提炼一周关键活动（会议/决策/里程碑）
- 任务要求：
  - 只保留关键事件
  - 输出 JSON：{ activities: { title, items } }

### 4) system_summary_week_patterns.md

- 功能目标：总结一周模式洞察（时间/习惯/效率）
- 任务要求：
  - 关注规律与变化
  - 输出 JSON：{ patterns: { title, items } }

### 5) system_summary_week_highlights.md

- 功能目标：提炼一周亮点与价值点
- 任务要求：
  - 强调价值与成果
  - 输出 JSON：{ highlights: { title, items } }

### 6) system_summary_week_vocab.md

- 功能目标：累计一周新词/术语，服务词库
- 任务要求：
  - 保持简洁、可复用
  - 输出 JSON：{ vocabulary_extracted: { title, items } }

### 7) system_summary_week_next_week.md

- 功能目标：给出下周建议与延续事项
- 任务要求：
  - 建议具体可执行
  - 不判断完成度
  - 输出 JSON：{ next_week: { title, items } }

---

## 月报（month）拆分 prompts

### 1) system_summary_month_summary.md

- 功能目标：月度宏观回顾（成就/变化/挑战）
- 任务要求：
  - 强调阶段性成果
  - 输出 JSON：{ summary: { title, content } }

### 2) system_summary_month_work_focus.md

- 功能目标：总结整月工作重心
- 任务要求：
  - 聚焦最核心的 2-3 个领域
  - 输出 JSON：{ work_focus: { title, items } }

### 3) system_summary_month_trends.md

- 功能目标：识别趋势变化（时间分配/效率/对比）
- 任务要求：
  - 关注趋势，不做细节堆砌
  - 输出 JSON：{ trends: { title, items } }

### 4) system_summary_month_highlights.md

- 功能目标：提炼月度里程碑与转折点
- 任务要求：
  - 强调关键成果
  - 输出 JSON：{ highlights: { title, items } }

### 5) system_summary_month_communication.md

- 功能目标：总结沟通模式与场景，为画像提供依据
- 任务要求：
  - 关注应用/场景/风格
  - 输出 JSON：{ communication_patterns: { title, items } }

### 6) system_summary_month_insights.md

- 功能目标：产出可执行洞察与改进方向
- 任务要求：
  - 强调行动性
  - 输出 JSON：{ insights: { title, items } }

### 7) system_summary_month_vocab.md

- 功能目标：沉淀月度高价值新词
- 任务要求：
  - 选择长期价值高的术语
  - 输出 JSON：{ vocabulary_extracted: { title, items } }

---

## 通用要求（所有拆分 prompt）

- 只输出严格 JSON，不包含任何额外文本
- 不使用 ```json 或任何代码块
- 无内容时返回空数组
- 不推断任务完成度
