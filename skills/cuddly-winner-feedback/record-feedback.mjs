import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const MAX_BYTES = 1024 * 1024;
const LOCATOR_NAME = "cuddly-winner-feedback-root";

function fail(message) {
  throw new Error(`cuddly-winner-feedback: ${message}`);
}

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BYTES) fail("report exceeds 1 MiB.");
    chunks.push(bytes);
  }
  if (size === 0 || !Buffer.concat(chunks).toString("utf8").trim()) fail("report is empty.");
  return Buffer.concat(chunks).toString("utf8");
}

function configRootFromInvocation(scriptPath) {
  const packageDir = path.dirname(path.resolve(scriptPath));
  const skillsDir = path.dirname(packageDir);
  if (path.basename(skillsDir) !== "skills") fail("must run from a deployed skills package.");
  return path.dirname(skillsDir);
}

async function feedbackRootFromLocator(scriptPath) {
  const locator = path.join(configRootFromInvocation(scriptPath), "feedback", LOCATOR_NAME);
  let locatorStat;
  try { locatorStat = await lstat(locator); } catch { fail("feedback locator is missing; reinstall from the intended Cuddly Winner clone."); }
  if (!locatorStat.isFile() || locatorStat.isSymbolicLink()) fail("feedback locator is unsafe; reinstall from the intended Cuddly Winner clone.");
  const raw = await readFile(locator, "utf8");
  if (!raw.endsWith("\n") || raw.slice(0, -1).includes("\n") || !path.isAbsolute(raw.slice(0, -1))) {
    fail("feedback locator is malformed; reinstall from the intended Cuddly Winner clone.");
  }
  const root = raw.slice(0, -1);
  if (path.basename(root) !== "feedback") fail("feedback locator is malformed; reinstall from the intended Cuddly Winner clone.");
  let rootStat;
  try { rootStat = await lstat(root); } catch { fail("feedback target is stale; reinstall from the intended Cuddly Winner clone."); }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("feedback target is stale; reinstall from the intended Cuddly Winner clone.");
  return realpath(root);
}

async function privateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

async function writeReport(root, report) {
  const inbox = path.join(root, "inbox");
  await privateDirectory(root);
  await privateDirectory(inbox);
  const capturedAt = new Date().toISOString();
  const body = `---\nschema_version: 1\nstatus: new\ncaptured_at: ${capturedAt}\n---\n\n${report}`;
  for (let attempt = 0; attempt < 10; attempt++) {
    const filename = `${capturedAt.replace(/[:.]/g, "-")}-${randomUUID()}.md`;
    const target = path.join(inbox, filename);
    try {
      const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      try { await handle.writeFile(body, "utf8"); } finally { await handle.close(); }
      await chmod(target, 0o600);
      return target;
    } catch (error) {
      if (error?.code !== "EEXIST" || attempt === 9) throw error;
    }
  }
  fail("could not allocate a unique report path.");
}

async function main() {
  const report = await readStdin();
  const root = await feedbackRootFromLocator(process.argv[1]);
  process.stdout.write(`${await writeReport(root, report)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
