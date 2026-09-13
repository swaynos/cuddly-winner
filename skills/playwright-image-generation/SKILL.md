---
name: playwright-image-generation
description: Use when automating web AI image generation or editing, including ChatGPT and Gemini; defaults to cuddly-winner-browser and covers approved Playwright/CDP overrides, login, verified image capture, failures, and dataset artifacts.
compatibility: opencode
---

# Playwright Image Generation

Browser image-generation runs are data collection, not casual UI scripting. Preserve auth, capture only verified image bytes, and leave an auditable trail.

## Browser Selection

Use `cuddly-winner-browser` by default for browser image generation. Project
instructions may override this default with another tool or approach. Use
Playwright/CDP only when project instructions override the default; the skill's
name is not an override.

Open the provider in Obscura and check whether login is required for the requested
action. Continue there if the action is public or Obscura is already signed in.
Only if login is required should you ask permission to open the user's browser
through the installed session capture helper. If no GUI or supported browser is
available, follow the project's fallback or stop rule.

## Playwright Override Credentials

The modes in this section apply only when project instructions require the
Playwright/CDP approach. Obscura login uses the managed session capture flow in
the browser-selection rule.

- `ephemeral` is the default: use a headless isolated browser and do not retain
  credentials after it closes.
- `persistent-headless` is opt-in: use only the managed provider-specific profile
  outside the project repository.
- `auth` is a one-time, user-approved visible-browser setup state. Never enter
  it automatically. After login, switch back to `persistent-headless`.

Do not use a personal default browser profile. Do not silently fall back to CDP
or a headed browser when headless authentication fails; report the provider
constraint and ask for approval.

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
- When a project override requires Playwright/CDP, prefer normal browser + CDP attach for Google/ChatGPT/Gemini auth or browser challenges. Only use Playwright-owned persistent contexts when the user explicitly chooses that mode and login/challenge behavior is verified.
- Do not trust provider download/API response bodies as images until signatures verify. A `.png` extension is not evidence.
- Do not count generation success until image bytes are saved and signature-verified.
- Do not treat raw run state as a protected dataset. Freeze valuable outputs into a release with manifests and checksums.

## Workflow

1. Check project instructions for a browser override. Otherwise use
   `cuddly-winner-browser`.
2. Open the provider and check whether login is required. If needed, use the
   approved managed capture flow, restart OpenCode, and confirm the restored
   session in Obscura.
3. When an override requires Playwright/CDP, verify that the protected profile
   path and run-state path are separate, then launch or attach to the approved
   browser endpoint.
4. Submit prompts through the selected UI unless project instructions validate a
   provider-specific API path.
5. Detect newly generated images using stable page evidence such as new
   `currentSrc`/`src`, not just a larger element count.
6. Save displayed generated images through browser-side extraction.
7. Verify file signatures and record hashes before marking success.
8. Record failures by layer: text refusal, backend/image guardrail, stalled,
   browser/UI, network, or unknown.
9. Freeze valuable runs into dataset releases before cleanup.

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
- `stalled`: timeout without image or terminal refusal. Also treat provider UI text like `Connection interrupted. Waiting for the complete answer` as a stall/silent-failure warning unless a verified image appears later.
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
- “Keep waiting forever because the provider did not explicitly refuse.”
- “Delete raw runs before freezing the dataset.”
- “Mix ChatGPT and Gemini selectors in one hard-coded path.”
