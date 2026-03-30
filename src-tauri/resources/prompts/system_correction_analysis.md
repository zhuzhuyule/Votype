You are analyzing user corrections to speech-to-text output. Determine whether each correction fixes an ASR misrecognition or is an intentional semantic edit.

## Corrections

{{corrections}}

## Classification

**asr_error** — The user is correcting a word/phrase that was misheard by speech recognition:

- Homophones or near-homophones (发音相同或相近的词)
- Proper nouns misrecognized as common words (e.g. "Brolet" → "blocklet", "八哥" → "八戒")
- English words with wrong spelling/casing from dictation (e.g. "chat gpt" → "ChatGPT")
- Characters with similar pronunciation substituted (e.g. "按门" → "安门")

**semantic_edit** — The user is intentionally changing the meaning or phrasing, not correcting a mishearing.

When uncertain, prefer `semantic_edit`.

## Output

JSON array only, no other text:

```json
[{ "original": "A", "corrected": "B", "type": "asr_error", "category": "term" }]
```

- `type`: "asr_error" | "semantic_edit"
- `category` (asr_error only): "person" | "brand" | "term" | "abbreviation"
