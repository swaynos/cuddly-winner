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

1. Identify the authenticated profile path and protect it.
2. Decide CDP attach versus explicit persistent-context mode.
3. Record composer selector, send selector, generated-image selector, and refusal text patterns.
4. Test one prompt and verify saved bytes by signature.
5. Confirm whether outputs are PNG, JPEG, or WebP.
6. Write a provider note or update this file with observed selectors.

Do not copy ChatGPT selectors into Gemini automation without re-verification.
