# ChatGPT Reference

Lessons from `comfyui-fiesta` ChatGPT image-generation runs.

## Proven Auth Pattern

For Google/ChatGPT auth stability, the validated path was:

1. Normal Chrome owns the protected profile.
2. Chrome starts with remote debugging enabled.
3. Playwright attaches over CDP with `chromium.connect_over_cdp(...)`.

Example shape:

```bash
python scripts/chatgpt_overnight_sampler.py \
  --launch-control-browser \
  --user-data-dir ./.browser/chatgpt-profile \
  --remote-debugging-port 9222
```

Then live automation uses:

```text
--connect-cdp-url http://127.0.0.1:9222
```

Direct Playwright-owned persistent launch can preserve auth in some environments, but this project observed Google/ChatGPT untrusted-browser issues on that path. Use CDP attach by default unless the user explicitly chooses and verifies persistent-context launch.

## Useful Selectors

- Composer: role textbox named `Chat with ChatGPT`.
- Send button: role button named `Send prompt` or `Send message`.
- Generated image: `img[alt*="Generated image" i], img[alt*="generated image" i]`.

Selectors are provider/UI-version observations, not contracts. Re-verify before long runs.

## Refusal/Guardrail Patterns

Common text fragments:

- `I can't help`
- `I can’t help`
- `may violate`
- `content policies`
- `guardrails`
- `nudity`
- `sexuality`
- `erotic content`

Silent/stall warning text observed in the UI:

- `Connection interrupted. Waiting for the complete answer`

Guardrail text can appear after prompt acceptance, so record text refusals and backend image guardrails separately when possible.

If the connection-interrupted text appears and no new generated image source is observed before timeout, record `outcome="stalled"` with `failure_layer="stalled"`. Do not retry indefinitely and do not count the attempt as success without a signature-verified image.

## New Image Detection

Track generated image `currentSrc || src` before submitting a prompt. Count success only when a new source appears and canvas extraction verifies image bytes.

Do not rely only on image count; the DOM can duplicate or reflow old generated-image elements.
