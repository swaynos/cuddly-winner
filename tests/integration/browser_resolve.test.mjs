import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { findBrowser, browserCandidates } from "../../scripts/opencode-browser-session.mjs";

// findBrowser is pure: platform and PATH are injected, so Linux and Windows
// resolution can be proven from a macOS host. Importing the module must not run
// the CLI — the main-guard in the script keeps parseArgs from firing.

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cuddly-resolve-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("browserCandidates returns a table for each supported platform and null otherwise", () => {
  for (const platform of ["darwin", "linux", "win32"]) {
    const table = browserCandidates(platform);
    assert.ok(table && table.chrome && table.edge && table.brave, `${platform} table`);
  }
  assert.equal(browserCandidates("sunos"), null);
});

test("findBrowser auto-resolves a Linux browser from PATH by bare command name", async () => fixture(async (root) => {
  const bin = path.join(root, "google-chrome");
  await writeFile(bin, "#!/bin/sh\n");
  await chmod(bin, 0o755);
  // pathValue is injected, so only the temp dir is searched; the bare-name
  // candidate matches before any absolute /usr/bin path a real host might have.
  assert.deepEqual(findBrowser("", { platform: "linux", pathValue: root }), { name: "chrome", binary: bin });
}));

test("findBrowser honors an explicit --browser choice on Linux", async () => fixture(async (root) => {
  const bin = path.join(root, "brave-browser");
  await writeFile(bin, "#!/bin/sh\n");
  await chmod(bin, 0o755);
  assert.deepEqual(findBrowser("brave", { platform: "linux", pathValue: root }), { name: "brave", binary: bin });
}));

test("findBrowser rejects an unsupported platform and an unsupported browser", () => {
  assert.match(findBrowser("chrome", { platform: "sunos" }).error, /unsupported platform: sunos/);
  assert.match(findBrowser("safari", { platform: "linux", pathValue: "" }).error, /unsupported --browser: safari/);
});

test("findBrowser reports absence deterministically when no candidate exists", async () => fixture(async (root) => {
  // win32 candidates are all absolute paths built from these env roots. Point
  // them at an empty temp tree so nothing resolves, on any host OS.
  const prior = {
    PROGRAMFILES: process.env.PROGRAMFILES,
    X86: process.env["PROGRAMFILES(X86)"],
    LOCAL: process.env.LOCALAPPDATA,
  };
  process.env.PROGRAMFILES = root;
  process.env["PROGRAMFILES(X86)"] = root;
  process.env.LOCALAPPDATA = root;
  try {
    assert.match(findBrowser("chrome", { platform: "win32", pathValue: "" }).error, /not installed/);
    assert.match(findBrowser("", { platform: "win32", pathValue: "" }).error, /no supported browser found/);
  } finally {
    if (prior.PROGRAMFILES === undefined) delete process.env.PROGRAMFILES; else process.env.PROGRAMFILES = prior.PROGRAMFILES;
    if (prior.X86 === undefined) delete process.env["PROGRAMFILES(X86)"]; else process.env["PROGRAMFILES(X86)"] = prior.X86;
    if (prior.LOCAL === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = prior.LOCAL;
  }
}));
