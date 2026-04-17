#!/usr/bin/env bash

set -euo pipefail

API_URL="${API_URL:-http://127.0.0.1:33178/v1}"
API_KEY="${API_KEY:-}"
MODEL_ID="${MODEL_ID:-}"
ASR_MODEL_ID="${ASR_MODEL_ID:-}"
AUDIO_FILE="${AUDIO_FILE:-}"

if [[ -z "${API_KEY}" ]]; then
  echo "API_KEY is required"
  exit 1
fi

if [[ -z "${MODEL_ID}" ]]; then
  echo "MODEL_ID is required for chat smoke test"
  exit 1
fi

echo "==> GET ${API_URL}/models"
curl -sS \
  -H "Authorization: Bearer ${API_KEY}" \
  "${API_URL}/models"
echo
echo

echo "==> POST ${API_URL}/chat/completions"
curl -sS \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d @- \
  "${API_URL}/chat/completions" <<JSON
{
  "model": "${MODEL_ID}",
  "messages": [
    { "role": "system", "content": "You are a concise assistant." },
    { "role": "user", "content": "Reply with the word READY only." }
  ],
  "stream": false
}
JSON
echo
echo

echo "==> POST ${API_URL}/chat/completions (stream=true compatibility)"
curl -sS \
  -N \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d @- \
  "${API_URL}/chat/completions" <<JSON
{
  "model": "${MODEL_ID}",
  "messages": [
    { "role": "user", "content": "Reply with STREAM-OK only." }
  ],
  "stream": true
}
JSON
echo
echo

if [[ -n "${ASR_MODEL_ID}" && -n "${AUDIO_FILE}" ]]; then
  echo "==> POST ${API_URL}/audio/transcriptions"
  curl -sS \
    -H "Authorization: Bearer ${API_KEY}" \
    -F "model=${ASR_MODEL_ID}" \
    -F "file=@${AUDIO_FILE}" \
    "${API_URL}/audio/transcriptions"
  echo
fi
