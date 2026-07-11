---
name: local-word-document
description: Use when creating a local Word (.docx) document from notes, planning data, or structured content. Covers the full workflow: markdown source → review → pandoc conversion → verification.
compatibility: opencode
---

# Local Word Document

Two-phase workflow: get the content right in markdown first, then convert. Never write .docx directly.

## Phase 1 — Write the markdown source

1. Determine the output directory (usually today's working notes folder).
2. Choose a filename: `Title-Case-With-Dashes.md` (the .docx will use the same stem).
3. Write the markdown. Rules:
   - Use `#` for the document title (becomes Word Heading 1).
   - Use `##` for section headers (Heading 2).
   - Use pipe tables for structured data — pandoc converts them to Word tables.
   - Use `[Link text](url)` for hyperlinks — pandoc renders them as Word hyperlinks.
   - Keep prose tight. This is a document, not a note dump.
4. Show the markdown to the user for review **before** converting.

## Phase 2 — Convert to Word

Once the markdown is approved:

```bash
pandoc input.md -o output.docx --from=markdown --to=docx
```

Verify the output is a real Word file (not HTML):

```bash
file output.docx
```

Expected: `Microsoft Word 2007+`

If `pandoc` is unavailable, fall back to `python-docx`:

```bash
python3 -c "import docx; print('ok')"
```

If neither is available, surface the gap and ask the user to install:
- pandoc: `brew install pandoc`
- python-docx: `pip install python-docx`

## Defaults

| Decision | Default |
|---|---|
| Tooling | pandoc (simpler); python-docx if style control is needed |
| Source kept? | Yes — markdown is the canonical editable source |
| Output location | Same directory as the markdown |
| Filename | Same stem as markdown, `.docx` extension |
| TBD cells | Leave as literal `TBD` — do not invent values |
| Noise | Cut prose filler, risks, and below-the-line sections unless explicitly requested |

## What not to do

- Do not write .docx directly with XML or raw bytes.
- Do not delete the markdown source after conversion.
- Do not add content that wasn't in the source data — flag gaps as `TBD` instead.
- Do not run the conversion until the user has reviewed the markdown.
