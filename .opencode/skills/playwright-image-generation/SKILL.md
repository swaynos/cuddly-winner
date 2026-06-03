---
name: playwright-image-generation
description: Use when automating web AI image generation or image editing with Playwright/CDP, including ChatGPT, Gemini, or similar browser UIs where auth profiles, generated-image capture, refusals, stalls, and dataset artifacts must be handled safely.
compatibility: opencode
---

# Playwright Image Generation

Browser image-generation runs are data collection, not casual UI scripting. Preserve auth, capture only verified image bytes, and leave an auditable trail.

## Trigger

Use this skill for ChatGPT, Gemini, or similar web UIs when the task involves:

- Generating or editing images through a browser.
- Reusing signed-in web auth.
- Capturing generated images from the page.
- Recording refusals, guardrails, stalls, or UI failures.
- Building a dataset or reusable image corpus.

## Hard Rules

- Treat authenticated browser profiles as protected state. Do not delete, move, recreate, overwrite, or silently replace them.
- Never fall back to a blank, default, temporary, or legacy profile when auth matters.
- Separate browser profile state from run state. Profiles hold cookies/auth; run directories hold logs, manifests, prompts, and images.
- Prefer normal browser + CDP attach when Google/ChatGPT/Gemini auth or browser challenges are involved. Only use Playwright-owned persistent contexts when the user explicitly chooses that mode and login/challenge behavior is verified.
- Do not trust provider download/API response bodies as images until signatures verify. A `.png` extension is not evidence.
- Do not count generation success until image bytes are saved and signature-verified.
- Do not treat raw run state as a protected dataset. Freeze valuable outputs into a release with manifests and checksums.

## Workflow

1. Identify provider and auth mode: ChatGPT, Gemini, or other web UI; CDP attach or explicit persistent-context mode.
2. Verify the protected profile path and run-state path are separate.
3. Launch or verify an already-open browser endpoint when using CDP.
4. Attach Playwright to the browser and wait for an authenticated composer.
5. Submit prompts through the UI unless a provider-specific API path is explicitly validated.
6. Detect newly generated images using stable page evidence such as new `currentSrc`/`src`, not just a larger element count.
7. Save displayed generated images through browser-side extraction.
8. Verify file signatures and record hashes before marking success.
9. Record failures by layer: text refusal, backend/image guardrail, stalled, browser/UI, network, or unknown.
10. Freeze valuable runs into dataset releases before cleanup.

## Image Capture

Preferred pattern for web image outputs:

```js
async (img) => {
  await img.decode().catch(() => {})
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return canvas.toDataURL('image/png').split(',')[1]
}
```

After decoding locally, verify the PNG signature:

```text
89 50 4E 47 0D 0A 1A 0A
```

If extracting JPEG/WebP, verify that format's signature instead and record the format explicitly.

## Failure Recording

Keep `outcome` separate from `failure_layer`.

- `success`: image bytes saved and signature-verified.
- `refused`: visible provider refusal or policy message.
- `stalled`: timeout without image or terminal refusal.
- `failed`: browser, UI, network, upload, or unexpected failure.

Recommended failure layers:

- `text_refusal`
- `image_backend_guardrail`
- `stalled`
- `browser_or_ui`
- `network`
- `unknown`

## Dataset Protection

- Raw run directory: operational evidence only.
- Curated output directory: convenient staging only.
- Frozen dataset release: canonical copy with manifest, events/chains when applicable, checksums, and dataset card.
- Preserve prompt text, provider, auth mode, source/output hashes, refusal text, elapsed time, and UI failure details.

## Provider References

- ChatGPT: `references/chatgpt.md`
- Gemini: `references/gemini.md`

## Red Flags

- “Just use a temp profile.”
- “The file is named `.png`, so it is fine.”
- “Use the latest image count only.”
- “Delete raw runs before freezing the dataset.”
- “Mix ChatGPT and Gemini selectors in one hard-coded path.”
