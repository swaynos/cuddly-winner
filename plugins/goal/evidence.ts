import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

export function canonical(value: string): boolean {
  return typeof value === "string" && !!value && !path.isAbsolute(value) && !value.includes("\\")
    && !/^[A-Za-z]:/.test(value) && value.split("/").every(p => p && p !== "." && p !== "..");
}

export async function captureFiles(root: string, files: string[]) {
  const result: Record<string, any> = {};
  const base = await realpath(root);
  for (const file of [...new Set(files)]) {
    if (!canonical(file)) throw new Error(`Noncanonical evidence path: ${file}`);
    const target = path.resolve(base, file);
    let handle;
    try {
      const stat = await lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || !(await realpath(target)).startsWith(base + path.sep)) {
        result[file] = { state: "unavailable" }; continue;
      }
      handle = await open(target, "r");
      const hash = createHash("sha256");
      for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
      result[file] = { state: "present", size: stat.size, sha256: hash.digest("hex") };
    } catch (error: any) { result[file] = { state: error.code === "ENOENT" ? "absent" : "unavailable" }; }
    finally { await handle?.close(); }
  }
  return result;
}

const git = promisify(execFile);
export async function initialWorktree(root: string, files: string[]) {
  const baseline: any = { captured_at: new Date().toISOString(), files: {}, status: [], limitations: [] };
  try {
    const { stdout } = await git("git", ["-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, timeout: 10000, maxBuffer: 1024 * 1024 });
    const entries = stdout.split("\0");
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      const change: any = { status: entry.slice(0, 2), path: entry.slice(3) };
      if (/[RC]/.test(change.status)) change.original_path = entries[++i];
      baseline.status.push(change);
    }
    if (baseline.status.length > 512) { baseline.status = baseline.status.slice(0, 512); baseline.limitations.push("Initial status exceeds 512 paths; unlisted changes have no attribution baseline."); }
  } catch { baseline.limitations.push("Initial Git status unavailable; later dirty status cannot prove authorship."); }
  baseline.files = await captureFiles(root, [...new Set([...files, ...baseline.status.map((entry: any) => entry.path)])]);
  return baseline;
}
