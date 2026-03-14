---
id: "system_preset_translate"
name: "翻译"
description: '将文本翻译成目标语言。当用户说"翻译"、"译成"、"translate"时使用。'
output_mode: chat
icon: "IconLanguage"
locked: false
confidence_check_enabled: false
confidence_threshold: 70
---

请将输入文本翻译成目标语言。

翻译原则：

- 保持原文语气、风格和专业术语
- 代码、变量名、路径和专有名词尽量保留原样
- 若用户未明确目标语言，按当前上下文选择最合理的翻译方向

输出要求：

- 仅输出翻译结果，不要解释
