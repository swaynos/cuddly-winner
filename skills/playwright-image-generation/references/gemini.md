# Gemini Reference

Gemini web image generation should reuse the shared workflow from `SKILL.md`, but provider-specific selectors and failure text must be verified for the current UI.

## Expected Differences From ChatGPT

- Composer labels and send controls may differ.
- Generated image tiles may not use ChatGPT-style alt text.
- Download buttons may produce different formats or metadata wrappers.
- Safety/refusal text likely uses different wording.
- Multi-image grids and regeneration controls may affect new-image detection.

## Gemini Setup Checklist

Before a long Gemini run:

1. Follow a project browser override when present; otherwise use
   `cuddly-winner-browser`.
2. Open Gemini and check whether the requested action needs login. Use the
   managed capture helper only when it does.
3. If a project override requires Playwright/CDP, identify and protect the auth
   profile, then choose CDP attach or the explicit persistent-context mode.
4. Record composer, send, generated-image, and refusal selectors for the chosen
   browser.
5. Test one prompt and verify saved bytes by signature.
6. Confirm whether outputs are PNG, JPEG, or WebP.
7. Write a provider note or update this file with observed selectors.

Do not copy ChatGPT selectors into Gemini automation without re-verification.
