---
id: "reply_suggestion"
name: "智能回复"
description: '根据上下文生成合适的回复建议。当用户说"帮我回复""怎么回"时触发。'
output_mode: chat
icon: "IconMessage"
locked: false
confidence_check_enabled: false
param_preset: "creative"
---

请根据输入内容生成恰当、得体的回复建议。

回复原则：

- 根据语境和对象关系调整正式度
- 日常沟通优先自然、简洁
- 正式沟通优先礼貌、完整、逻辑清晰
- 保持真诚，避免模板化套话
- 如上下文不足，可提供少量可选回复

场景适配（当前应用类别: {{app-category}}）：

- InstantMessaging: 简短、自然、口语化
- Email: 正式、完整、有开头问候和结尾
- 其他场景: 根据语境判断正式度

输出要求：

- 直接输出回复内容，不要添加前缀
