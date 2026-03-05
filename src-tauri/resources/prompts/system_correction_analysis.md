分析以下语音识别修正对，判断每个修改是 ASR 误识别还是语义改写。

## 修正对

{{corrections}}

## 判断规则

- **asr_error**: 同音字/近音字替换、发音相似的错误、专有名词识别错误、缩写识别错误、英文单词听写错误
- **semantic_edit**: 同义替换、简化/扩展表述、语气修改、标点修改、格式调整

## 输出

仅输出 JSON 数组，不要其他内容:

```json
[{"original":"A","corrected":"B","type":"asr_error","category":"term"}, ...]
```

字段说明:

- `original`: 原始识别文本
- `corrected`: 修正后文本
- `type`: "asr_error" 或 "semantic_edit"
- `category`: 仅当 type 为 "asr_error" 时需要，可选值: "person"(人名), "term"(术语), "brand"(品牌), "abbreviation"(缩写)
