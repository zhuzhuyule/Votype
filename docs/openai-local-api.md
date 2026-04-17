# OpenAI-compatible Local API

Handy can expose a local OpenAI-compatible API backed by the same internal model routing, multi-key failover, and online ASR execution path used by the desktop app.

## Where to configure it

Open `Settings -> Advanced -> Local API`.

Available options:

- `Enable OpenAI-compatible Local API`
- `Allow LAN Access`
- `Port`
- `Endpoint`
- `Access Key`

Notes:

- Changing `Access Key` takes effect immediately.
- Changing `Allow LAN Access`, `Port`, or `Endpoint` requires restarting the app.
- When `Allow LAN Access` is disabled, the server binds to `127.0.0.1` only.
- When `Allow LAN Access` is enabled, the server binds to `0.0.0.0` and is reachable from other devices in the same LAN.

## Supported endpoints

- `GET /models`
- `POST /chat/completions`
- `POST /audio/transcriptions`

These routes are exposed under your configured endpoint path. For example, if the endpoint is `/v1`, the full URLs are:

- `http://127.0.0.1:33178/v1/models`
- `http://127.0.0.1:33178/v1/chat/completions`
- `http://127.0.0.1:33178/v1/audio/transcriptions`

## Compatibility notes

- `model` must use Handy's `cached_model.id`
- `stream=true` is supported in compatibility mode
- Current streaming behavior is pseudo-streaming:
  the server waits for the final result, then returns it as one SSE chunk followed by `[DONE]`

## Supported chat request fields

The local API accepts these common OpenAI-compatible fields and forwards them as request overrides when present:

- `temperature`
- `top_p`
- `max_tokens`
- `frequency_penalty`
- `presence_penalty`
- `response_format`

## curl examples

### Models

```bash
curl -H "Authorization: Bearer $API_KEY" \
  "$API_URL/models"
```

### Chat

```bash
curl -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-cached-model-id",
    "messages": [
      { "role": "user", "content": "Say hello." }
    ]
  }' \
  "$API_URL/chat/completions"
```

### Chat with stream compatibility

```bash
curl -N -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-cached-model-id",
    "messages": [
      { "role": "user", "content": "Say hello." }
    ],
    "stream": true
  }' \
  "$API_URL/chat/completions"
```

### Transcription

```bash
curl -H "Authorization: Bearer $API_KEY" \
  -F "model=your-asr-cached-model-id" \
  -F "file=@sample.wav" \
  "$API_URL/audio/transcriptions"
```

## Smoke test script

Use:

```bash
API_KEY="..." \
MODEL_ID="your-cached-model-id" \
API_URL="http://127.0.0.1:33178/v1" \
bash scripts/openai_local_api_smoke.sh
```

Optional ASR check:

```bash
API_KEY="..." \
MODEL_ID="your-cached-model-id" \
ASR_MODEL_ID="your-asr-cached-model-id" \
AUDIO_FILE="/path/to/sample.wav" \
API_URL="http://127.0.0.1:33178/v1" \
bash scripts/openai_local_api_smoke.sh
```
