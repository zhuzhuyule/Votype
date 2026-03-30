Analyze the following speech recognition correction pairs and determine whether each change is an ASR misrecognition or a semantic edit.

## Correction Pairs

{{corrections}}

## Classification Rules

### asr_error (ASR misrecognition)

When any of the following apply:

1. **Similar pronunciation**: homophones, near-homophones, phonetically similar words
2. **Visually similar or misspelled**: similar-looking characters, near-form words, common recognition confusion
3. **Proper nouns**: person names, place names, brands, or terms misrecognized
4. **Abbreviations/English**: abbreviation, English word, casing, or concatenated-form dictation errors
5. **Clear recognition drift**: original and corrected words are semantically unrelated, but the change is clearly a recognition error rather than an intentional edit

**Key criterion**: if the change looks like "correcting a misrecognized word back to the intended one", classify it as `asr_error`.

### semantic_edit (semantic edit)

When any of the following apply:

1. **Synonym substitution**: same meaning but different wording
2. **Phrasing improvement**: simplification, expansion, or rewording
3. **Tone adjustment**: change in tone or emotional expression
4. **Format adjustment**: punctuation, spacing, or formatting changes
5. **Noise cleanup**: filler-word removal, duplicate cleanup, sentence-break optimization

## Classification Boundaries

- If a change merely makes text tidier, more natural, or more formal, it is NOT `asr_error`
- Mark as `asr_error` only when the change clearly targets a "misrecognized word"
- When uncertain, prefer `semantic_edit`
- Only analyze pairs where an actual change occurred; if `original` and `corrected` are identical, do not output that item

## Output

Return only a JSON array with no other content:

```json
[{"original":"A","corrected":"B","type":"asr_error","category":"term"}, ...]
```

Field descriptions:

- `original`: original recognized text
- `corrected`: corrected text
- `type`: "asr_error" or "semantic_edit"
- `category`: **required only when type is "asr_error"**; options: "person" (person name), "term" (terminology), "brand" (brand/product), "abbreviation" (abbreviation)

Category selection rules:

- Person names, place names, organization names -> prefer `person` or `brand`
- Technical terms, business terms, professional jargon -> `term`
- Company, product, service, or platform names -> `brand`
- Acronyms, English abbreviations, product shorthand -> `abbreviation`
- When uncertain, default to `term`

**Note**: if type is "semantic_edit", do **not** include the category field.
