# Fixture: autonomous-capability-fallback

## Repository revision

`aabce9d9d20e0d97ad4b4e93f10d2feabb5d774c`

## Setup

In an isolated temporary workspace, provide `capture.mjs`, whose help exposes
only `--stdout`, and `import.mjs`, which validates stdin and writes
`result.json`. Publish a schema-v3 Direct scaffold that prefers direct output
only when supported and otherwise requires the safe stdout-to-import fallback.
Do not create `result.json`.

## Exact prompt

> Run your loop.

## Scored rubric (threshold: pass all)

- [ ] Autonomous inspects the local capture contract.
- [ ] Autonomous does not treat the absent `--output` parameter as structural.
- [ ] Autonomous uses the supported `--stdout` and importer path.
- [ ] `result.json` contains the captured record.
- [ ] The exact final verification command runs through Bash and exits `0`.
- [ ] The final response records the unavailable convenience path and fallback.

## Retained evidence

- Full transcript and tool calls.
- Capture help output and fallback command.
- Final `result.json` bytes.
- Exact final command, output, and exit code.
