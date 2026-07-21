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
  "/.opencode/runs/",
  "/.opencode/supervisor/",
  "/.opencode/progress/",
  "/.opencode/quarantine/",
];

export const MANAGED_BLOCK = [BEGIN, ...MANAGED_PATHS, END].join("\n");

export interface ScaffoldGitignoreResult {
  changed: boolean;
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

function stripManagedBlock(content: string): string {
  const lines = content.split(/\r?\n/);
  const begins = lines.filter((l) => l.trim() === BEGIN).length;
  const ends = lines.filter((l) => l.trim() === END).length;
  if (begins === 0 && ends === 0) return content;
  if (begins !== 1 || ends !== 1) {
    throw new Error("scaffold_gitignore: duplicate or malformed managed markers; refusing to guess.");
  }
  const start = lines.findIndex((l) => l.trim() === BEGIN);
  const stop = lines.findIndex((l) => l.trim() === END);
  if (stop < start) {
    throw new Error("scaffold_gitignore: END marker precedes BEGIN marker.");
  }
  const before = lines.slice(0, start);
  const after = lines.slice(stop + 1);
  // Drop one blank separator we may have inserted before the block.
  if (before.length && before[before.length - 1] === "") before.pop();
  return [...before, ...after].join("\n");
}

function composeContent(unrelated: string): string {
  const trimmed = unrelated.replace(/\s+$/, "");
  if (trimmed === "") return `${MANAGED_BLOCK}\n`;
  return `${trimmed}\n\n${MANAGED_BLOCK}\n`;
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

export async function applyScaffoldGitignore(root: string): Promise<ScaffoldGitignoreResult> {
  const resolvedRoot = path.resolve(root);
  const gitignorePath = path.join(resolvedRoot, ".gitignore");
  assertSafeTarget(gitignorePath);

  let existing = "";
  let mode: number | undefined;
  if (existsSync(gitignorePath)) {
    existing = await fs.readFile(gitignorePath, "utf8");
    mode = (await fs.stat(gitignorePath)).mode & 0o777;
  }

  const unrelated = stripManagedBlock(existing);
  const next = composeContent(unrelated);
  const changed = next !== existing;

  if (changed) {
    const tmp = path.join(resolvedRoot, `.gitignore.tmp.${process.pid}.${Date.now()}`);
    await fs.writeFile(tmp, next, { mode: mode ?? 0o644 });
    if (mode !== undefined) await fs.chmod(tmp, mode);
    await fs.rename(tmp, gitignorePath);
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

export const __testing = { stripManagedBlock, composeContent, MANAGED_BLOCK, assertSafeTarget, os };

export default tool({
  description:
    "Manage the canonical OpenCode Autonomous block in the project .gitignore. Takes no path arguments.",
  args: {},
  async execute(_args, context) {
    const root = path.resolve(
      (context as { worktree?: string; directory?: string }).worktree ??
        (context as { directory?: string }).directory ??
        process.cwd(),
    );
    return JSON.stringify(await applyScaffoldGitignore(root), null, 2);
  },
});
