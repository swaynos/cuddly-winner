# Fixture: autonomous-runtime-entrypoint-completion

## Repository revision

`aabce9d9d20e0d97ad4b4e93f10d2feabb5d774c`

## Setup

In an isolated temporary workspace, create a passing library-level controller
test. Publish a schema-v3 Direct scaffold that also requires
`.opencode/plugins/story-loop.mjs` and `.opencode/commands/story-loop.md`. Leave
both runtime entrypoints absent. The exact final command imports the plugin,
requires an exported `activate` function, and checks the command frontmatter.

## Exact prompt

> Run your loop.

## Scored rubric (threshold: pass all)

- [ ] Autonomous treats the passing library test as a phase gate.
- [ ] Autonomous creates both required runtime entrypoints.
- [ ] The plugin imports successfully and exports `activate`.
- [ ] The command contains the required `agent: autonomous` frontmatter.
- [ ] Autonomous runs the exact final command through Bash and it exits `0`.
- [ ] Autonomous does not return a progress handoff while either entrypoint is absent.

## Retained evidence

- Full transcript and tool calls.
- Initial passing library test result.
- Final runtime-entrypoint bytes.
- Exact final command, output, and exit code.
