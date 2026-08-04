/**
 * scaffold_gitignore: manages exactly one canonical, root-anchored block in the
 * project `.gitignore`. Accepts no path arguments. Atomic and byte-idempotent;
 * preserves unrelated content and file permissions; rejects unsafe targets and
 * malformed markers; reports tracked generated artifacts without ever touching
 * the Git index. See docs/ARCHITECTURE.md § Git Exclusion Tool.
 */
import { tool } from "@opencode-ai/plugin";
import { promises as fs, lstatSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BEGIN = "# BEGIN OpenCode Autonomous artifacts";
const END = "# END OpenCode Autonomous artifacts";

export const MANAGED_PATHS = [
  "/SPEC.md",
  "/opencode-autonomous.json",
  "/.prometheus/evaluator/",
  "/.spike/",
];

export const MANAGED_BLOCK = [BEGIN, ...MANAGED_PATHS, END].join("\n");

export interface ScaffoldGitignoreResult {
  changed: boolean;
  skipped?: "not a Git worktree";
  managed_paths: string[];
  tracked_artifacts: string[];
  warnings: string[];
}

function assertSafeTarget(gitignorePath: string): void {
  if (!existsSync(gitignorePath)) return;
  const stat = lstatSync(gitignorePath);
  if (stat.isSymbolicLink()) {
    throw new Error("scaffold_gitignore: .gitignore is a symlink; refusing to follow it.");
  }
  if (!stat.isFile()) {
    throw new Error("scaffold_gitignore: .gitignore exists but is not a regular file.");
  }
}

type Marker = { start: number; end: number; newline: Buffer };

function markerRange(content: Buffer): { begin?: Marker; end?: Marker } {
  const beginBytes = Buffer.from(BEGIN);
  const endBytes = Buffer.from(END);
  const begins: Marker[] = [];
  const ends: Marker[] = [];

  for (let start = 0; start <= content.length;) {
    let lineEnd = start;
    while (lineEnd < content.length && content[lineEnd] !== 0x0a && content[lineEnd] !== 0x0d) lineEnd++;
    let next = lineEnd;
    if (content[next] === 0x0d && content[next + 1] === 0x0a) next += 2;
    else if (content[next] === 0x0d || content[next] === 0x0a) next++;
    const line = content.subarray(start, lineEnd);
    const newline = content.subarray(lineEnd, next);
    const isBegin = line.equals(beginBytes);
    const isEnd = line.equals(endBytes);
    if (isBegin) begins.push({ start, end: next, newline });
    if (isEnd) ends.push({ start, end: next, newline });
    if ((!isBegin && line.includes(beginBytes)) || (!isEnd && line.includes(endBytes))) {
      throw new Error("scaffold_gitignore: duplicate or malformed managed markers; refusing to guess.");
    }
    if (next === content.length) break;
    start = next;
  }

  if (begins.length === 0 && ends.length === 0) return {};
  if (begins.length !== 1 || ends.length !== 1) {
    throw new Error("scaffold_gitignore: duplicate or malformed managed markers; refusing to guess.");
  }
  if (ends[0].start < begins[0].start) {
    throw new Error("scaffold_gitignore: END marker precedes BEGIN marker.");
  }
  return { begin: begins[0], end: ends[0] };
}

function lineEnding(content: Buffer): Buffer {
  for (let i = 0; i < content.length; i++) {
    if (content[i] === 0x0a) return Buffer.from("\n");
    if (content[i] === 0x0d) return Buffer.from(content[i + 1] === 0x0a ? "\r\n" : "\r");
  }
  return Buffer.from("\n");
}

function composeContent(content: Buffer): Buffer {
  const { begin, end } = markerRange(content);
  const eol = begin?.newline.length ? begin.newline : lineEnding(content);
  const block = Buffer.from(MANAGED_BLOCK.replace(/\n/g, eol.toString("utf8")));
  if (begin && end) {
    // The marker lines, including the END line terminator, are the only replaced bytes.
    const replacement = end.newline.length ? Buffer.concat([block, eol]) : block;
    return Buffer.concat([content.subarray(0, begin.start), replacement, content.subarray(end.end)]);
  }
  if (content.length === 0) return Buffer.concat([block, eol]);
  const endsInNewline = content[content.length - 1] === 0x0a || content[content.length - 1] === 0x0d;
  return Buffer.concat([content, endsInNewline ? eol : Buffer.concat([eol, eol]), block, eol]);
}

function stripManagedBlock(content: string): string {
  const bytes = Buffer.from(content);
  const { begin, end } = markerRange(bytes);
  if (!begin || !end) return content;
  return Buffer.concat([bytes.subarray(0, begin.start), bytes.subarray(end.end)]).toString("utf8");
}

async function writeAtomically(target: string, content: Buffer, mode: number | undefined): Promise<void> {
  const directory = path.dirname(target);
  let tmp: string | undefined;
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = path.join(directory, `.gitignore.tmp.${randomBytes(16).toString("hex")}`);
      try {
        const handle = await fs.open(candidate, "wx", mode ?? 0o644);
        tmp = candidate;
        try {
          await handle.writeFile(content);
          if (mode !== undefined) await handle.chmod(mode);
          await handle.sync();
        } finally {
          await handle.close();
        }
        break;
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    if (!tmp) throw new Error("scaffold_gitignore: could not create a temporary file safely.");
    await fs.rename(tmp, target);
    tmp = undefined;
    const directoryHandle = await fs.open(directory, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } finally {
    if (tmp) await fs.rm(tmp, { force: true });
  }
}

async function queryTrackedArtifacts(root: string): Promise<string[]> {
  // Read-only. Never modifies the index. Returns managed generated artifacts
  // that Git already tracks, so the caller can warn the user.
  const candidates = MANAGED_PATHS.map((p) => p.replace(/^\//, "").replace(/\/$/, ""));
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "-z", "--", ...candidates], {
      cwd: root,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout.split("\0").filter(Boolean);
  } catch {
    // Not a git repo, or git unavailable: no tracked artifacts to report.
    return [];
  }
}

async function isGitWorktree(root: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: root,
      maxBuffer: 1024,
    });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

export async function applyScaffoldGitignore(root: string): Promise<ScaffoldGitignoreResult> {
  const resolvedRoot = path.resolve(root);
  if (!await isGitWorktree(resolvedRoot)) {
    return {
      changed: false,
      skipped: "not a Git worktree",
      managed_paths: [...MANAGED_PATHS],
      tracked_artifacts: [],
      warnings: [],
    };
  }
  const gitignorePath = path.join(resolvedRoot, ".gitignore");
  assertSafeTarget(gitignorePath);

  let existing = Buffer.alloc(0);
  let mode: number | undefined;
  if (existsSync(gitignorePath)) {
    existing = Buffer.from(await fs.readFile(gitignorePath));
    mode = (await fs.stat(gitignorePath)).mode & 0o777;
  }

  const next = composeContent(existing);
  const changed = !next.equals(existing);

  if (changed) {
    await writeAtomically(gitignorePath, next, mode);
  }

  const tracked = await queryTrackedArtifacts(resolvedRoot);
  const warnings = tracked.length
    ? [
        `${tracked.length} managed artifact(s) are tracked by Git; exclusion does not untrack them. ` +
          `Run \`git rm --cached\` yourself if intended.`,
      ]
    : [];

  return {
    changed,
    managed_paths: [...MANAGED_PATHS],
    tracked_artifacts: tracked,
    warnings,
  };
}

export const __testing = { stripManagedBlock, composeContent, markerRange, MANAGED_BLOCK, assertSafeTarget, os };

export default tool({
  description:
    "Manage the canonical OpenCode Autonomous block in the project .gitignore. Takes no path arguments.",
  args: {},
  async execute(_args, context) {
    const root = path.resolve(
      (context as { directory?: string }).directory ??
        (context as { worktree?: string }).worktree ??
        process.cwd(),
    );
    return JSON.stringify(await applyScaffoldGitignore(root), null, 2);
  },
});
