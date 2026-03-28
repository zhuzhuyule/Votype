# Votype 主程序选中模式与执行窗口改写模式设计

## 目标

为 Votype 自有窗口定义一套稳定、低误判的语音后处理规则：

- 主程序只按“有选中 / 无选中”两态工作。
- 执行窗口（`review_window`）不再优先考虑插入，而是围绕当前全文做改写。
- 避免在 Votype 自有窗口里进行开放式 skill 匹配，降低误判和交互复杂度。

本设计只覆盖模式定义、上下文组织和模型输入输出结构，不直接展开实现任务。

## 设计原则

### 1. 规则硬路由优先于模型猜测

对于 Votype 自有窗口，不让模型先猜“这次到底是插入、润色还是 skill”，而是由窗口类型和选中状态先决定大模式，再把任务交给对应的固定处理链路。

### 2. 主程序偏输入，执行窗口偏改写

- 主程序本质上是轻量输入场景，重点是快速落字。
- 执行窗口本质上是编辑场景，重点是围绕已有内容修订、重写和调整。

### 3. 先收敛，再扩展

第一版先保证行为稳定，不提前支持“自动续写”“最近片段修复”“复杂 skill 匹配”等高误判能力。

## 范围

### 本次纳入

- 主程序在有选中和无选中时的固定行为
- `review_window` 在语音开始、结束、送模型时的上下文冻结规则
- 主程序和 `review_window` 的模型输入结构
- `review_window` 的输出落地规则

### 本次不纳入

- `review_window` 的语音续写模式
- 基于“最近一次输出片段”的自动修订
- 通用 skill 池中的开放式能力匹配
- 额外确认窗或多轮交互

## 模式定义

### 主程序（`main`）

主程序固定为两态：

#### 1. 无选中：`polish_insert`

- ASR 原文先做基础润色
- 结果直接插入当前光标位置
- 不进入 skill 路由

#### 2. 有选中：`selected_edit`

- 不再把 ASR 结果视为“要插入的新文本”
- 而是把它视为“如何修改当前选中内容的口述指令”
- 该模式走固定的“编辑选中内容”处理链，不进入通用 skill 匹配

### 执行窗口（`review_window`）

`review_window` 第一版固定为单一主模式：

#### `rewrite_document`

- 用户按下录音键时，冻结当前执行窗口全文
- 这份冻结内容视为本次语音操作的原始文稿
- 用户本次口述内容视为对该文稿的修订指令
- 输出结果默认是“改写后的完整文稿”
- 结果直接替换当前执行窗口全文

这个模式不优先考虑“插入一段新文本”，而是优先理解为：

“请根据我刚才说的话，对当前这篇内容做修改。”

## 上下文组织

### 主程序无选中：局部上下文润色

主程序无选中时，模型上下文应尽量轻量，只提供局部语境约束，不做全文总结。

建议输入：

- `before_context`：光标前 200 到 400 字
- `after_context`：光标后 100 到 300 字
- `spoken_text`：ASR 原文

用途：

- 保持语气、时态和人称一致
- 减少和相邻句子的重复
- 改善局部衔接

不建议提供全文，也不建议先做全文摘要。

### 主程序有选中：选中内容编辑上下文

主程序有选中时，模型输入应围绕被编辑目标构造：

- `selected_text`
- `before_context`
- `after_context`
- `spoken_instruction`

其中：

- `selected_text` 是主要修改对象
- `before_context` / `after_context` 用于帮助模型理解选中内容在原文中的位置和语气
- `spoken_instruction` 是 ASR 识别并做基础清洗后的口述要求

第一版建议输出只支持：

- `replace_selection`

即直接生成新的选中内容，替换掉原选区。暂不开放“追加到选中后方”等分支。

### 执行窗口：全文冻结上下文

`review_window` 在按下录音键的瞬间冻结当前全文，记为：

- `document_text`

录音结束后，ASR 结果记为：

- `spoken_instruction`

必要时可附带：

- `selection_text`

但 `selection_text` 不是必须项；即使没有选区，仍然按“修改当前全文”处理。

## 模型任务定义

### 主程序无选中：`main-inline-polish`

模型职责：

- 对 `spoken_text` 做润色
- 结合前后局部上下文保持表达自然
- 输出适合直接插入光标位置的文本

输出形式：

- 纯文本

### 主程序有选中：`main-selected-edit`

模型职责：

- 读取 `selected_text`
- 根据 `spoken_instruction` 对其改写
- 保留未被要求修改的有效信息
- 输出新的选中内容

输出形式：

- 纯文本，直接用于替换选中内容

### 执行窗口：`review-window-rewrite`

模型职责：

- 读取 `document_text`
- 根据 `spoken_instruction` 对全文做修订
- 尽量保留原文结构和有效内容
- 只在用户指令涉及的地方做必要修改
- 输出修改后的完整文稿

输出形式：

- 纯文本，直接覆盖当前执行窗口全文

## 为什么执行窗口先不做插入

当前执行窗口的主要价值不在“边说边加一段”，而在：

- 对已有内容做二次润色
- 纠正、删减、改写
- 按口语要求重新组织表达

因此第一版把 `review_window` 固定成全文改写模式，能够显著降低误判：

- 不需要判断“这次是插入还是改写”
- 不需要判断“要不要续写”
- 不需要把语音输入拆成局部 patch

后续如果真实使用中续写需求足够高，再在 `review_window` 上单独扩展“append”模式。

## 推荐 Prompt 结构

### `main-inline-polish`

输入结构：

```text
Context before cursor:
{before_context}

Context after cursor:
{after_context}

Spoken text:
{spoken_text}

Task:
Polish the spoken text so it fits naturally at the cursor position.
Return only the final text.
```

### `main-selected-edit`

输入结构：

```text
Context before selection:
{before_context}

Selected text:
{selected_text}

Context after selection:
{after_context}

Spoken instruction:
{spoken_instruction}

Task:
Rewrite the selected text according to the spoken instruction.
Preserve intent unless the instruction explicitly requests structural change.
Return only the rewritten replacement text.
```

### `review-window-rewrite`

输入结构：

```text
Current document:
{document_text}

Spoken instruction:
{spoken_instruction}

Task:
Revise the current document according to the spoken instruction.
Keep existing useful content unless the instruction asks to remove or rewrite it.
Return only the full revised document.
```

## 落地规则

### 主程序

- `polish_insert`：把模型输出插入当前光标
- `selected_edit`：用模型输出替换当前选区

### 执行窗口

- 在按下录音键时冻结全文
- 录音结束后把冻结全文和口述指令送入 `review-window-rewrite`
- 模型返回完整文本后，整体替换执行窗口当前内容

注意：

- 替换的基准是“按下录音键时冻结的全文”，不是送模型那一刻窗口中的最新内容
- 这样可以确保模型推理上下文稳定，避免处理中途用户继续编辑导致语义漂移

## 错误与回退策略

### 主程序

- 若 `selected_edit` 失败，则不自动覆盖选区
- 可以保守回退为不执行替换，并保留原内容

### 执行窗口

- 若 `review-window-rewrite` 失败，则保持原始全文不变
- 不要把 ASR 文本直接插进当前文稿，避免把修订指令污染正文

## 风险与取舍

### 风险 1：主程序有选中但用户其实想插入

这是有意接受的取舍。第一版把规则定死为“有选中就编辑选中内容”，优先保证确定性和低误判。

### 风险 2：执行窗口里有时用户其实想续写

这也是第一版有意不覆盖的场景。当前优先目标是稳定的全文改写，而不是同时兼顾续写和插入。

### 风险 3：全文改写可能带来过度修改

这依赖 prompt 约束。`review-window-rewrite` 必须明确要求：

- 保留原文有效内容
- 仅针对口述要求做必要改动
- 不做无关扩写或重构

## 建议的第一阶段实施边界

1. 主程序接入“有选中 / 无选中”硬路由
2. 主程序有选中时新增固定的 `main-selected-edit` 处理链
3. `review_window` 在录音开始时冻结全文
4. `review_window` 用冻结全文 + 口述指令做完整改写
5. `review_window` 先只支持“整体替换全文”，不做插入和续写

## 结论

第一版最稳的做法是：

- 主程序：按“选中 / 非选中”两态处理
- 执行窗口：按“全文改写”单态处理

这样既满足主程序快速输入，也满足执行窗口围绕现有内容做高质量修订，同时避免过早引入高误判的开放式 skill 匹配和自动续写逻辑。
