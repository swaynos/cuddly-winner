import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile, chmod } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findBrowser, browserCandidates } from "../../scripts/opencode-browser-session.mjs";

const run = promisify(execFile);
const session = path.resolve(import.meta.dirname, "../../scripts/opencode-browser-session.mjs");

// findBrowser is pure: platform and PATH are injected, so Linux and Windows
// resolution can be proven from a macOS host. Importing the module must not run
// the CLI — the main-guard in the script keeps parseArgs from firing.

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cuddly-resolve-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function processIsRunning(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
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

test("findBrowser checks PATH before standard application locations on macOS", async () => fixture(async (root) => {
  const bin = path.join(root, "google-chrome");
  await writeFile(bin, "#!/bin/sh\n", { mode: 0o755 });
  assert.deepEqual(findBrowser("", { platform: "darwin", pathValue: root }), { name: "chrome", binary: bin });
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

test("findBrowser ignores a non-executable file and a directory on Linux", async () => fixture(async (root) => {
  const file = path.join(root, "google-chrome");
  const directory = path.join(root, "chromium");
  await writeFile(file, "not executable\n", { mode: 0o644 });
  await mkdir(directory);
  const result = findBrowser("chrome", { platform: "linux", pathValue: root });
  assert.notEqual(result.binary, file);
  assert.notEqual(result.binary, directory);
}));

test("capture fails before launch when Linux has no graphical session", { skip: process.platform !== "linux" }, async () => fixture(async (root) => {
  const browser = path.join(root, "google-chrome");
  await writeFile(browser, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await assert.rejects(
    run(process.execPath, [session, "capture", "--config-dir", root, "--name", "A", "--url", "https://example.com/login", "--origin", "https://example.com", "--cookie", "sid", "--timeout", "1"], {
      env: { ...process.env, PATH: root, DISPLAY: "", WAYLAND_DISPLAY: "" },
    }),
    (error) => error.code === 1 && /no graphical session/i.test(error.stderr),
  );
}));

test("capture reports a browser that exits before its DevTools endpoint starts", async () => fixture(async (root) => {
  const browser = path.join(root, "google-chrome");
  await writeFile(browser, "#!/bin/sh\nexit 7\n", { mode: 0o755 });
  const started = Date.now();
  await assert.rejects(
    run(process.execPath, [session, "capture", "--config-dir", root, "--name", "A", "--url", "https://example.com/login", "--origin", "https://example.com", "--cookie", "sid", "--timeout", "5"], {
      env: { ...process.env, PATH: root, DISPLAY: ":99", WAYLAND_DISPLAY: "" },
    }),
    (error) => error.code === 1 && /browser exited before.*DevTools endpoint/i.test(error.stderr),
  );
  assert.ok(Date.now() - started < 3000, "capture waited for its full timeout after the browser exited");
}));

test("capture rejects an unsafe session destination before launching a browser", async () => fixture(async (root) => {
  const browser = path.join(root, "google-chrome");
  const marker = path.join(root, "launched");
  const sessions = path.join(root, "cuddly-winner-sessions");
  await writeFile(browser, `#!/bin/sh\nprintf launched > "${marker}"\nexit 0\n`, { mode: 0o755 });
  await mkdir(sessions);
  await symlink(path.join(root, "outside.json"), path.join(sessions, "A.json"));

  await assert.rejects(
    run(process.execPath, [session, "capture", "--config-dir", root, "--name", "A", "--url", "https://example.com/login", "--origin", "https://example.com", "--cookie", "sid", "--timeout", "1"], {
      env: { ...process.env, PATH: root, DISPLAY: ":99", WAYLAND_DISPLAY: "" },
    }),
    (error) => error.code === 1 && /session file is a symlink/i.test(error.stderr),
  );
  await assert.rejects(access(marker), (error) => error.code === "ENOENT");
}));

test("capture rejects a symlinked sessions directory before launching a browser", async () => fixture(async (root) => {
  const browser = path.join(root, "google-chrome");
  const marker = path.join(root, "launched-from-directory-test");
  const outside = path.join(root, "outside");
  await writeFile(browser, `#!/bin/sh\nprintf launched > "${marker}"\nexit 0\n`, { mode: 0o755 });
  await mkdir(outside);
  await symlink(outside, path.join(root, "cuddly-winner-sessions"));

  await assert.rejects(
    run(process.execPath, [session, "capture", "--config-dir", root, "--name", "A", "--url", "https://example.com/login", "--origin", "https://example.com", "--cookie", "sid", "--timeout", "1"], {
      env: { ...process.env, PATH: root, DISPLAY: ":99", WAYLAND_DISPLAY: "" },
    }),
    (error) => error.code === 1 && /sessions directory is a symlink/i.test(error.stderr),
  );
  await assert.rejects(access(marker), (error) => error.code === "ENOENT");
}));

test("capture reports a browser spawn error", async () => fixture(async (root) => {
  const browser = path.join(root, "google-chrome");
  await writeFile(browser, "#!/definitely/not/a/real/interpreter\n", { mode: 0o755 });
  await assert.rejects(
    run(process.execPath, [session, "capture", "--config-dir", root, "--name", "A", "--url", "https://example.com/login", "--origin", "https://example.com", "--cookie", "sid", "--timeout", "5"], {
      env: { ...process.env, PATH: root, DISPLAY: ":99", WAYLAND_DISPLAY: "" },
    }),
    (error) => error.code === 1 && /browser failed to start.*DevTools endpoint/i.test(error.stderr),
  );
}));

test("capture stops an unresponsive browser before removing its temporary profile", async () => fixture(async (root) => {
  const browser = path.join(root, "google-chrome");
  const marker = path.join(root, "browser-state");
  await writeFile(browser, `#!/bin/sh
profile=""
for arg in "$@"; do
  case "$arg" in --user-data-dir=*) profile="\${arg#*=}" ;; esac
done
printf '%s\n%s\n' "$$" "$profile" > "${marker}"
trap '' TERM
while :; do /bin/sleep 1; done
`, { mode: 0o755 });

  let pid;
  let profile;
  try {
    await assert.rejects(
      run(process.execPath, [session, "capture", "--config-dir", root, "--name", "A", "--url", "https://example.com/login", "--origin", "https://example.com", "--cookie", "sid", "--timeout", "1"], {
        env: { ...process.env, PATH: root, DISPLAY: ":99", WAYLAND_DISPLAY: "" },
      }),
      (error) => error.code === 1 && /DevTools endpoint never came up/i.test(error.stderr),
    );
    [pid, profile] = (await readFile(marker, "utf8")).trim().split("\n");
    assert.throws(() => process.kill(Number(pid), 0), (error) => error.code === "ESRCH");
    await assert.rejects(access(profile), (error) => error.code === "ENOENT");
  } finally {
    if (pid) {
      try { process.kill(Number(pid), "SIGKILL"); } catch { /* already stopped */ }
    }
  }
}));

test("capture bounds a stalled DevTools request and still cleans up", async () => fixture(async (root) => {
  const browser = path.join(root, "google-chrome");
  const server = path.join(root, "stalled-server.mjs");
  const marker = path.join(root, "stalled-state");
  await writeFile(server, `
import net from "node:net";
import { writeFileSync } from "node:fs";
const [port, profile, marker] = process.argv.slice(2);
writeFileSync(marker, process.pid + "\\n" + profile + "\\n");
net.createServer(() => {}).listen(Number(port), "127.0.0.1");
`, { mode: 0o644 });
  await writeFile(browser, `#!/bin/sh
port=""
profile=""
for arg in "$@"; do
  case "$arg" in
    --remote-debugging-port=*) port="\${arg#*=}" ;;
    --user-data-dir=*) profile="\${arg#*=}" ;;
  esac
done
exec "${process.execPath}" "${server}" "$port" "$profile" "${marker}"
`, { mode: 0o755 });

  let pid;
  let profile;
  let executionError;
  try {
    await run(process.execPath, [session, "capture", "--config-dir", root, "--name", "A", "--url", "https://example.com/login", "--origin", "https://example.com", "--cookie", "sid", "--timeout", "1"], {
      env: { ...process.env, PATH: root, DISPLAY: ":99", WAYLAND_DISPLAY: "" },
      timeout: 6000,
    });
  } catch (error) {
    executionError = error;
  } finally {
    try { [pid, profile] = (await readFile(marker, "utf8")).trim().split("\n"); } catch { /* Assert below. */ }
    if (pid) {
      try { process.kill(Number(pid), 0); } catch { pid = undefined; }
    }
    if (pid) {
      try { process.kill(Number(pid), "SIGKILL"); } catch { /* already stopped */ }
    }
  }

  assert.ok(executionError, "capture unexpectedly succeeded against a stalled endpoint");
  assert.match(executionError.stderr, /DevTools endpoint never came up/i);
  assert.equal(pid, undefined, "stalled browser remained alive after capture failed");
  await assert.rejects(access(profile), (error) => error.code === "ENOENT");
}));

test("capture bounds a stalled DevTools WebSocket call", async () => fixture(async (root) => {
  const browser = path.join(root, "google-chrome");
  const server = path.join(root, "stalled-websocket.mjs");
  const marker = path.join(root, "websocket-state");
  await writeFile(server, `
import net from "node:net";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
const [port, profile, marker] = process.argv.slice(2);
writeFileSync(marker, process.pid + "\\n" + profile + "\\n");
const listener = net.createServer((socket) => socket.once("data", (data) => {
  const request = data.toString("utf8");
  if (request.startsWith("GET /json/version ")) {
    const body = JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:" + port + "/devtools/browser/test", "User-Agent": "test" });
    socket.end("HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\nContent-Length: " + Buffer.byteLength(body) + "\\r\\nConnection: close\\r\\n\\r\\n" + body);
    return;
  }
  const key = request.match(/sec-websocket-key:\\s*([^\\r\\n]+)/i)?.[1];
  const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n");
}));
listener.listen(Number(port), "127.0.0.1");
`, { mode: 0o644 });
  await writeFile(browser, `#!/bin/sh
port=""
profile=""
for arg in "$@"; do
  case "$arg" in
    --remote-debugging-port=*) port="\${arg#*=}" ;;
    --user-data-dir=*) profile="\${arg#*=}" ;;
  esac
done
exec "${process.execPath}" "${server}" "$port" "$profile" "${marker}"
`, { mode: 0o755 });

  let pid;
  let profile;
  try {
    await assert.rejects(
      run(process.execPath, [session, "capture", "--config-dir", root, "--name", "A", "--url", "https://example.com/login", "--origin", "https://example.com", "--cookie", "sid", "--timeout", "1"], {
        env: { ...process.env, PATH: root, DISPLAY: ":99", WAYLAND_DISPLAY: "" },
        timeout: 6000,
      }),
      (error) => error.code === 1 && /CDP Storage\.getCookies timed out/.test(error.stderr),
    );
    [pid, profile] = (await readFile(marker, "utf8")).trim().split("\n");
    assert.equal(processIsRunning(pid), false, "WebSocket test browser remained alive");
    await assert.rejects(access(profile), (error) => error.code === "ENOENT");
  } finally {
    if (pid && processIsRunning(pid)) process.kill(Number(pid), "SIGKILL");
  }
}));

test("capture reports browser exit while a login CDP call is pending", async () => fixture(async (root) => {
  const browser = path.join(root, "google-chrome");
  const server = path.join(root, "exiting-websocket.mjs");
  await writeFile(server, `
import net from "node:net";
import { createHash } from "node:crypto";
const [port] = process.argv.slice(2);
const listener = net.createServer((socket) => socket.once("data", (data) => {
  const request = data.toString("utf8");
  if (request.startsWith("GET /json/version ")) {
    const body = JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:" + port + "/devtools/browser/test", "User-Agent": "test" });
    socket.end("HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\nContent-Length: " + Buffer.byteLength(body) + "\\r\\nConnection: close\\r\\n\\r\\n" + body);
    return;
  }
  const key = request.match(/sec-websocket-key:\\s*([^\\r\\n]+)/i)?.[1];
  const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n");
  setTimeout(() => process.exit(9), 50);
}));
listener.listen(Number(port), "127.0.0.1");
`, { mode: 0o644 });
  await writeFile(browser, `#!/bin/sh
port=""
for arg in "$@"; do
  case "$arg" in --remote-debugging-port=*) port="\${arg#*=}" ;; esac
done
exec "${process.execPath}" "${server}" "$port"
`, { mode: 0o755 });

  const started = Date.now();
  await assert.rejects(
    run(process.execPath, [session, "capture", "--config-dir", root, "--name", "A", "--url", "https://example.com/login", "--origin", "https://example.com", "--cookie", "sid", "--timeout", "5"], {
      env: { ...process.env, PATH: root, DISPLAY: ":99", WAYLAND_DISPLAY: "" },
    }),
    (error) => error.code === 1 && /browser exited before login completion was detected \(exit code 9\)/i.test(error.stderr),
  );
  assert.ok(Date.now() - started < 3000, "capture did not report the browser exit promptly");
}));
