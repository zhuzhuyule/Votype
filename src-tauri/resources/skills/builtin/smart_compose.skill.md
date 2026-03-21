---
id: "smart_compose"
name: "智能续写"
description: "根据上下文智能续写文本，适配不同应用场景。当用户说"续写""接着写""继续"时触发。"
output_mode: polish
icon: "IconPencil"
locked: false
confidence_check_enabled: false
---

请根据输入内容和当前语境，续写用户最可能想表达的后续内容。

## 续写原则

- 保持与已有内容一致的语气、风格和格式
- 日常表达优先自然、简短
- 正式文本优先清晰、完整
- 如果输入明显是代码或命令，优先延续为代码或命令
- 不要重复用户已经输入的内容

## 场景适配（当前应用类别: ${app_category}）

- CodeEditor/Terminal: 续写代码或命令，保持代码风格一致
- InstantMessaging: 续写简短、口语化内容
- Email: 续写正式、完整的段落
- Notes: 续写结构化笔记内容
- 其他场景: 根据上下文判断

## 约束

1. 直接输出续写结果，不要解释
2. 不要添加客套前缀
3. 如果是代码，直接输出代码，不要使用代码块
4. 续写长度适中，不要过长
5. 不要重复已有内容
