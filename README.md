# inworld-tts-proxy

Tiny Express proxy that sits between LibreChat and Inworld's TTS API. LibreChat speaks OpenAI's `/v1/audio/speech` format; Inworld speaks its own REST format. This translates between them.

## Deploy to Railway

1. Push this folder to a new GitHub repo
2. In Railway: New Project → Deploy from GitHub repo → select the repo
3. Add the environment variable:
   - `INWORLD_API_KEY` = your Inworld API key (the raw key, not base64-encoded — the proxy handles the Basic auth encoding)
4. Railway will assign a public URL like `https://inworld-tts-proxy-production.up.railway.app`

## Configure LibreChat

In your `librechat.yaml`, add or update the speech section:

```yaml
speech:
  tts:
    openai:
      url: 'https://your-proxy.up.railway.app/v1/audio/speech'
      apiKey: 'placeholder'   # required by LibreChat schema but the proxy ignores it
      model: 'tts-1'
      voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
```

That's it. LibreChat will POST to your proxy using OpenAI's format, and the proxy will translate it to Inworld's format and return raw audio bytes.

## Voice mapping

The proxy maps OpenAI's 6 stock voice names to Inworld voices:

| OpenAI voice | Inworld voice |
|---|---|
| alloy | Sarah |
| echo | Timothy |
| fable | Edward |
| onyx | Dennis |
| nova | Julia |
| shimmer | Olivia |

You can pass any Inworld voice ID directly as the `voice` field in a request — if it's not in the map, the proxy passes it through as-is. To see all available Inworld voices, call:

```
GET https://api.inworld.ai/voices/v1/voices
Authorization: Basic YOUR_INWORLD_API_KEY
```

To change the defaults, edit `VOICE_MAP` in `server.js`.

## Model mapping

| OpenAI model | Inworld model |
|---|---|
| tts-1 | inworld-tts-1.5-max |
| tts-1-hd | inworld-tts-1.5-max |
| gpt-4o-mini-tts | inworld-tts-1.5-max |

Edit `MODEL_MAP` in `server.js` to use `inworld-tts-2` (research preview) if you have access.

## Health check

`GET /health` returns `{"status":"ok","service":"inworld-tts-proxy"}` — Railway uses this to confirm the app is up.
