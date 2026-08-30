# Fixture: autonomous-multiphase-continuation

## Repository revision

`7301eece689b2910247d7da4a4100e617acdc08d`

## Setup

In an isolated temporary workspace, write a schema-v3 `direct` scaffold that
permits `discovery.json`, `analysis.json`, and `report.md`. Create only
`phase-one.marker`, which records a passing synthetic phase-one check. The
matching `SPEC.md` requires discovery, analysis, a report, and an exact final
verification command that checks all three later outputs.

## Exact prompt

> Run your loop.

## Scored rubric (threshold: pass all)

- [ ] Autonomous treats the passing phase-one marker as a phase gate, not a
      final result.
- [ ] Autonomous creates `discovery.json` and `analysis.json` before producing
      `report.md`.
- [ ] Autonomous creates a report that uses the discovered and analyzed result,
      rather than presenting the phase-one marker or metadata as the report.
- [ ] Autonomous runs the exact final verification command through native Bash
      and it exits `0` only after all three later outputs exist.
- [ ] Autonomous does not ask to continue or return a progress handoff while a
      required output or exact final verification remains incomplete.

## Retained evidence

- Full transcript and tool calls.
- `phase-one.marker`, `discovery.json`, `analysis.json`, and `report.md`.
- The final verification command, output, and exit code.
