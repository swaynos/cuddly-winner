#!/usr/bin/env node
// Standalone bootstrap for the Obscura headless browser engine.
// No project-specific logic: any project can install, locate, or remove a
// checksum-verified Obscura binary under its own root. Cuddly Winner is one
// consumer; the managed MCP entry points its command at the located binary.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Pinned release. Checksums are the SHA-256 digests of the default
// (render, non-stealth) release archives for v0.2.2. They are only valid for
// this exact version; a different --version needs its own verified archive.
export const ENGINE_VERSION = "0.2.2";
const RELEASE_BASE = "https://github.com/h4ckf0r0day/obscura/releases/download";
const DIR_NAME = "cuddly-winner-browser";

const ASSETS = {
  "darwin-arm64": { asset: "obscura-aarch64-macos.tar.gz", sha256: "607471654d0c23799abd3bf45d1f4afd314a11fdbe1ee376e29018f32a2dfab9" },
  "darwin-x64": { asset: "obscura-x86_64-macos.tar.gz", sha256: "a60ad71a9e8d6ab1b8f51d3ddca8e043178b9c03c704719d6e717f77ead3ee43" },
  "linux-arm64": { asset: "obscura-aarch64-linux.tar.gz", sha256: "fd422a9bc0cb38047d270c2d0ee393df5c4d54fa9d0130d39917e858cd7020ae" },
  "linux-x64": { asset: "obscura-x86_64-linux.tar.gz", sha256: "9e5d9d081909ea983bc8c94999bb3d411fd6b74a9788504295b7e25f84310505" },
  "win-x64": { asset: "obscura-x86_64-windows.zip", sha256: "db5a3c951f7172eb8f25e6d71bd7120c7128f70f6daed55a6cc4caaabe1674d6" },
};

const ACTIONS = new Set(["install", "status", "remove", "path"]);

function die(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

function usage() {
  process.stderr.write(
    "Usage: opencode-browser-engine.mjs <install|status|remove|path> --root <dir> " +
      "[--version <tag>] [--platform <darwin-arm64|darwin-x64|linux-arm64|linux-x64|win-x64>] " +
      "[--archive <path>] [--checksum <sha256>]\n",
  );
}

function parseArgs(argv) {
  const [action, ...rest] = argv;
  if (!ACTIONS.has(action)) {
    usage();
    die(`unknown action: ${action ?? "(missing)"}`);
  }
  const options = { action, root: "", version: ENGINE_VERSION, platform: "", archive: "", checksum: "" };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (["--root", "--version", "--platform", "--archive", "--checksum"].includes(key)) {
      const value = rest[++index];
      if (value === undefined) die(`${key} requires a value`);
      options[key.slice(2)] = value;
    } else {
      die(`unknown argument: ${key}`);
    }
  }
  if (!options.root) die("--root is required");
  // Overriding the pinned checksum is only for installing a locally supplied
  // archive. It must never weaken verification of a network download.
  if (options.checksum && !options.archive) die("--checksum is only allowed together with --archive");
  return options;
}

export function platformKey(override) {
  if (override) {
    if (!ASSETS[override]) throw new Error(`unsupported platform: ${override}`);
    return override;
  }
  if (process.platform === "win32") {
    if (process.arch !== "x64") throw new Error(`unsupported platform: win32/${process.arch}`);
    return "win-x64";
  }
  const osName = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : "";
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : "";
  const key = osName && arch ? `${osName}-${arch}` : "";
  if (!ASSETS[key]) throw new Error(`unsupported platform: ${process.platform}/${process.arch}`);
  return key;
}

export function binaryName(key) {
  return key.startsWith("win") ? "obscura.exe" : "obscura";
}

export function engineDir(root) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, DIR_NAME);
  if (resolved !== path.join(resolvedRoot, DIR_NAME)) throw new Error("engine directory escapes root");
  if (existsSync(resolved) && lstatSync(resolved).isSymbolicLink()) throw new Error("engine directory is a symlink");
  return resolved;
}

export function binaryPath(root, override) {
  return path.join(engineDir(root), binaryName(platformKey(override)));
}

function manifestPath(dir) {
  return path.join(dir, ".engine.json");
}

function readManifest(dir) {
  try {
    const value = JSON.parse(readFileSync(manifestPath(dir), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value;
  } catch {
    return null;
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function isExecutableFile(target) {
  return existsSync(target) && !lstatSync(target).isSymbolicLink() && lstatSync(target).isFile();
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.isFile() && entry.name === name) {
      return full;
    }
  }
  return null;
}

async function download(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`download failed: ${response.status} ${response.statusText} (${url})`);
  return Buffer.from(await response.arrayBuffer());
}

function extract(archivePath, destination, isZip) {
  if (isZip) execFileSync("unzip", ["-q", archivePath, "-d", destination]);
  else execFileSync("tar", ["-xzf", archivePath, "-C", destination]);
}

async function install(options) {
  const key = platformKey(options.platform);
  const spec = ASSETS[key];
  const expected = options.checksum || spec.sha256;
  const dir = engineDir(options.root);
  const binName = binaryName(key);
  const workerName = key.startsWith("win") ? "obscura-worker.exe" : "obscura-worker";
  const target = path.join(dir, binName);

  const existing = readManifest(dir);
  if (existing && existing.version === options.version && existing.sha256 === expected && isExecutableFile(target)) {
    process.stdout.write(`Engine unchanged: obscura v${options.version} (${key}) -> ${target}\n`);
    return;
  }

  const isZip = key.startsWith("win");
  const stage = mkdtempSync(path.join(os.tmpdir(), "cuddly-engine-"));
  try {
    let archivePath = options.archive ? path.resolve(options.archive) : "";
    let buffer;
    if (archivePath) {
      if (!existsSync(archivePath)) throw new Error(`archive not found: ${archivePath}`);
      buffer = readFileSync(archivePath);
    } else {
      const url = `${RELEASE_BASE}/v${options.version}/${spec.asset}`;
      buffer = await download(url);
      archivePath = path.join(stage, spec.asset);
      writeFileSync(archivePath, buffer);
    }

    const actual = sha256(buffer);
    if (actual !== expected) {
      throw new Error(
        `checksum mismatch for ${key} v${options.version}: expected ${expected}, got ${actual}` +
          (options.version !== ENGINE_VERSION ? ` (checksums are pinned only for v${ENGINE_VERSION})` : ""),
      );
    }

    const unpacked = path.join(stage, "unpacked");
    mkdirSync(unpacked, { recursive: true });
    extract(archivePath, unpacked, isZip);
    const foundBinary = findFile(unpacked, binName);
    if (!foundBinary) throw new Error(`archive did not contain ${binName}`);
    const foundWorker = findFile(unpacked, workerName);

    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    copyFileSync(foundBinary, target);
    chmodSync(target, 0o755);
    if (foundWorker) {
      const workerTarget = path.join(dir, workerName);
      copyFileSync(foundWorker, workerTarget);
      chmodSync(workerTarget, 0o755);
    }
    writeFileSync(
      manifestPath(dir),
      `${JSON.stringify({ version: options.version, platform: key, sha256: expected }, null, 2)}\n`,
      { mode: 0o600 },
    );
    process.stdout.write(`Installed obscura v${options.version} (${key}) -> ${target}\n`);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function status(options) {
  const key = platformKey(options.platform);
  const dir = engineDir(options.root);
  const target = path.join(dir, binaryName(key));
  const manifest = readManifest(dir);
  if (!manifest || !isExecutableFile(target)) {
    process.stdout.write(`  [missing] browser engine: obscura (expected v${options.version})\n`);
    process.exitCode = 1;
    return;
  }
  if (manifest.version !== options.version) {
    process.stdout.write(`  [version mismatch: ${manifest.version}] browser engine: obscura (expected v${options.version})\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`  [current: ${manifest.version}] browser engine: obscura\n`);
}

function remove(options) {
  const dir = engineDir(options.root);
  if (!existsSync(dir)) {
    process.stdout.write("No managed browser engine to remove.\n");
    return;
  }
  rmSync(dir, { recursive: true, force: true });
  process.stdout.write("Removed managed browser engine.\n");
}

function printPath(options) {
  process.stdout.write(`${binaryPath(options.root, options.platform)}\n`);
}

export async function apply(options) {
  if (options.action === "install") return install(options);
  if (options.action === "status") return status(options);
  if (options.action === "remove") return remove(options);
  return printPath(options);
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  (async () => {
    try {
      await apply(parseArgs(process.argv.slice(2)));
    } catch (error) {
      die(error.message);
    }
  })();
}
