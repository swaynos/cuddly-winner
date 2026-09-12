import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, writeFile, chmod, readFile, stat, lstat } from "node:fs/promises";

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../..");
const engine = path.join(repo, "scripts", "opencode-browser-engine.mjs");
const PLATFORM = "darwin-arm64"; // pinned so the test is host-independent

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cuddly-engine-test-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function invoke(args) {
  return run("node", [engine, ...args]);
}

// Build a real .tar.gz containing fake obscura + obscura-worker binaries and
// return its path plus SHA-256, so the checksum-verified install path runs
// fully offline.
async function fakeArchive(root) {
  const source = path.join(root, "src");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "obscura"), "#!/bin/sh\necho obscura fake\n");
  await writeFile(path.join(source, "obscura-worker"), "#!/bin/sh\necho worker fake\n");
  await chmod(path.join(source, "obscura"), 0o755);
  await chmod(path.join(source, "obscura-worker"), 0o755);
  const archive = path.join(root, "fake.tar.gz");
  await run("tar", ["-czf", archive, "-C", source, "obscura", "obscura-worker"]);
  const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
  return { archive, digest };
}

test("install verifies checksum, lands an executable binary, and is idempotent", async () => fixture(async (root) => {
  const dest = path.join(root, "dest");
  await mkdir(dest, { recursive: true });
  const { archive, digest } = await fakeArchive(root);

  const first = await invoke(["install", "--root", dest, "--platform", PLATFORM, "--archive", archive, "--checksum", digest]);
  assert.match(first.stdout, /Installed obscura v0\.2\.2 \(darwin-arm64\)/);

  const binary = path.join(dest, "cuddly-winner-browser", "obscura");
  const worker = path.join(dest, "cuddly-winner-browser", "obscura-worker");
  assert.ok((await stat(binary)).isFile());
  assert.ok((await stat(worker)).isFile());
  assert.ok((await stat(binary)).mode & 0o111, "binary should be executable");

  const pathOut = await invoke(["path", "--root", dest, "--platform", PLATFORM]);
  assert.equal(pathOut.stdout.trim(), binary);

  const good = await invoke(["status", "--root", dest, "--platform", PLATFORM]);
  assert.match(good.stdout, /\[current: 0\.2\.2\] browser engine: obscura/);

  const second = await invoke(["install", "--root", dest, "--platform", PLATFORM, "--archive", archive, "--checksum", digest]);
  assert.match(second.stdout, /Engine unchanged/);
}));

test("install refuses an archive whose checksum does not match", async () => fixture(async (root) => {
  const dest = path.join(root, "dest");
  await mkdir(dest, { recursive: true });
  const { archive } = await fakeArchive(root);
  const wrong = "0".repeat(64);
  await assert.rejects(
    invoke(["install", "--root", dest, "--platform", PLATFORM, "--archive", archive, "--checksum", wrong]),
    (error) => error.code === 1 && /checksum mismatch/.test(error.stderr),
  );
  await assert.rejects(stat(path.join(dest, "cuddly-winner-browser", "obscura")));
}));

test("--checksum without --archive is rejected", async () => fixture(async (root) => {
  await assert.rejects(
    invoke(["install", "--root", root, "--platform", PLATFORM, "--checksum", "0".repeat(64)]),
    (error) => error.code === 1 && /--checksum is only allowed together with --archive/.test(error.stderr),
  );
}));

test("status and remove report and clear drift", async () => fixture(async (root) => {
  const dest = path.join(root, "dest");
  await mkdir(dest, { recursive: true });

  await assert.rejects(
    invoke(["status", "--root", dest, "--platform", PLATFORM]),
    (error) => error.code === 1 && /\[missing\] browser engine: obscura/.test(error.stdout),
  );

  const { archive, digest } = await fakeArchive(root);
  await invoke(["install", "--root", dest, "--platform", PLATFORM, "--archive", archive, "--checksum", digest]);
  const removed = await invoke(["remove", "--root", dest, "--platform", PLATFORM]);
  assert.match(removed.stdout, /Removed managed browser engine\./);
  await assert.rejects(lstat(path.join(dest, "cuddly-winner-browser")));
}));

test("path is deterministic before install and requires a root", async () => fixture(async (root) => {
  const dest = path.join(root, "dest");
  const pathOut = await invoke(["path", "--root", dest, "--platform", PLATFORM]);
  assert.equal(pathOut.stdout.trim(), path.join(dest, "cuddly-winner-browser", "obscura"));
  await assert.rejects(invoke(["path", "--platform", PLATFORM]), /--root is required/);
}));

test("an unsupported platform override is rejected", async () => fixture(async (root) => {
  await assert.rejects(
    invoke(["path", "--root", root, "--platform", "solaris-sparc"]),
    (error) => error.code === 1 && /unsupported platform: solaris-sparc/.test(error.stderr),
  );
}));
