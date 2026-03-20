---
id: "grammar_fix"
name: "语法修正"
description: "修正语法错误,去除口语化表达,优化文本流畅度"
output_mode: polish
icon: "IconSparkles"
locked: false
confidence_check_enabled: false
---

请修正输入文本中的语法错误、口语化冗余和明显不自然表达，使其更通顺自然。

处理原则：

- 保持原意，不添加新内容
- 优先修正语法、标点、搭配和明显重复
- 仅做适度整理，不要过度改变表达风格
- 技术内容优先保持术语准确

场景适配（当前应用类别: ${app_category}）：

- CodeEditor/Terminal: 保留技术术语和代码片段，仅修正自然语言部分
- InstantMessaging: 保持口语化风格，仅修正明显语法错误
- Email: 输出正式、完整的表达
- 其他场景: 按通用书面语标准处理

输出要求：

- 只输出修正后的文本，不要解释
