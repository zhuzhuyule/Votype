# 润色质量评估与词级变动分析

评估语音转录润色结果的质量，并逐词分析所有变动。

## 输入

原始转录：
{{source_text}}

润色结果：
{{target_text}}

## 任务

1. 对比原始转录与润色结果，提取所有**词级别**的变动（A → B）
2. 对每个变动判断是否为 ASR 误识别（同音字/近音字/谐音替换），即是否适合加入热词表
3. 给出整体置信度评分

## 变动分类规则

- **is_hotword = true**：同音字/近音字/谐音替换、专有名词识别错误、英文单词听写错误、缩写识别错误（适合加入热词表）
- **is_hotword = false**：语法修正、标点调整、语气词增删、语序调整、同义替换等语义层面的润色

## 输出格式

严格返回 JSON，不要其他内容：

```json
{
  "confidence": 85,
  "changes": [
    {
      "original": "A",
      "corrected": "B",
      "is_hotword": true,
      "category": "term"
    },
    { "original": "C", "corrected": "D", "is_hotword": false }
  ]
}
```

字段说明：

- `confidence`: 0-100 整体润色质量评分
- `changes`: 词级变动数组，无变动时为空数组 `[]`
- `original`: 原始转录中的词/短语
- `corrected`: 润色后的词/短语
- `is_hotword`: 是否为 ASR 误识别（适合加入热词表）
- `category`: 仅当 `is_hotword` 为 true 时填写，可选值: "person"(人名), "term"(术语), "brand"(品牌), "abbreviation"(缩写)

置信度参考：

- 90-100: 完全保留原意且明显改善
- 70-89: 基本正确，改善明显
- 50-69: 可能存在语义偏差
- 0-49: 有明显问题，需人工审查
