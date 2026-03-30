# Polish Quality Assessment and Word-Level Change Analysis

Evaluate the quality of a speech transcription polish result and analyze all changes at the word level.

## Input

Original transcription:
{{source_text}}

Polished result:
{{target_text}}

## Task

1. Compare original transcription with polished result; extract all **actual word-level changes** (A -> B)
2. For each change, determine whether it is an ASR misrecognition suitable for adding to the hotword list
3. Provide an overall confidence score

## Change Classification Rules

### is_hotword = true

When any of the following apply:

1. Homophone, near-homophone, or visually similar character substitution
2. Misrecognition of proper nouns such as person names, place names, brands, or terms
3. ASR dictation errors in English words, abbreviations, casing, or concatenated forms
4. The original and corrected words are semantically unrelated, but the change is clearly a recognition error rather than an intentional edit

### is_hotword = false

When any of the following apply:

1. Grammar correction, word-order adjustment, or phrasing improvement
2. Punctuation, spacing, line-break, or formatting normalization
3. Filler-word insertion/removal, repetition cleanup, or spoken-noise removal
4. Synonym substitution, tone adjustment, or other semantic-level polishing

## Classification Boundaries

- If a change merely makes text tidier, smoother, or more formal, it is NOT a hotword
- Mark `is_hotword = true` only when the change looks like "correcting a misrecognized word back to the intended one"
- When uncertain, prefer `is_hotword = false` to avoid false additions to the hotword list
- Only include items where an **actual change occurred**; if `original` and `corrected` are identical, or merely repeat unchanged content, do not output that item
- Do not split unchanged words into entries to inflate the count; every item in `changes` must be a clear A -> B modification

## Output Format

Return strictly JSON with no other content:

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

Field descriptions:

- `confidence`: 0-100 overall polish quality score
- `changes`: word-level change array; empty array `[]` when no changes
- `original`: word/phrase from the original transcription
- `corrected`: word/phrase after polishing
- `is_hotword`: whether this is an ASR misrecognition (suitable for hotword list)
- `category`: required only when `is_hotword` is true; options: "person" (person name), "term" (terminology), "brand" (brand/product), "abbreviation" (abbreviation)

## Category Selection Rules

- Person names, place names, organization names -> prefer `person` or `brand`
- Technical terms, business terms, professional jargon -> `term`
- Company, product, service, or platform names -> `brand`
- Acronyms, English abbreviations, product shorthand -> `abbreviation`
- When uncertain, default to `term`

Confidence reference:

- 90-100: Fully preserves original meaning with clear improvement
- 70-89: Mostly correct with noticeable improvement
- 50-69: Possible semantic deviation
- 0-49: Obvious issues requiring manual review
