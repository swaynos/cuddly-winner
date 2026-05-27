import test from "node:test";
import assert from "node:assert/strict";

import {
  evidencePasses,
  findAllEvidenceBlocks,
  findLastEvidenceBlock,
} from "../../plugins/shared/evidence.js";

test("findAllEvidenceBlocks parses valid JSON fences and skips invalid", () => {
  const text = [
    "before",
    "```json",
    '{"command":"pytest -q","exit_code":1}',
    "```",
    "```json",
    "{not json}",
    "```",
    "```evidence",
    '{"command":"pytest -q","exit_code":0}',
    "```",
  ].join("\n");

  const blocks = findAllEvidenceBlocks(text);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].exit_code, 1);
  assert.equal(blocks[1].exit_code, 0);
});

test("findLastEvidenceBlock returns the most recent block", () => {
  const text = "```json\n{\"command\":\"a\",\"exit_code\":1}\n```\n```json\n{\"command\":\"b\",\"exit_code\":0}\n```";
  const last = findLastEvidenceBlock(text);
  assert.equal(last.command, "b");
  assert.equal(last.exit_code, 0);
});

test("evidencePasses requires last block exit_code 0", () => {
  assert.equal(evidencePasses([]), false);
  assert.equal(evidencePasses([{ command: "x", exit_code: 1 }]), false);
  assert.equal(evidencePasses([{ command: "x", exit_code: 0 }]), true);
  assert.equal(
    evidencePasses([
      { command: "x", exit_code: 0 },
      { command: "y", exit_code: 1 },
    ]),
    false,
  );
});
