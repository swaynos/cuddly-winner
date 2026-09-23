#!/usr/bin/env node
// Retire only exact copies or repository links from removed managed profile releases.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import path from "node:path";

const FILES = [
  ["agents/reviewer.md", "669911a5d42184ef4a78fdb8b3693cc6382b5809e038ae5585569b513eb8065d"],
  ["plugins/autonomous-kpis.ts", "bbd9227a834e70951d360738e576043e67a8017d0af2bc8b0c4f933d3e851c22"],
  ["plugins/announce-hygiene.ts", "10c05469f3f6576254646676285afacaec4c5efca3509f3391bbb5900124489a"],
  ["tools/validate_scaffold.ts", "5e0fe4bd2cca16a11b53f93fd6f849d06549492e9e5cb6a0cdc71b8a44f0e281"],
  ["tools/scaffold_gitignore.ts", "2401eb0f0e7338d48fdce4a638fbe53a0416c821057fe320bccc5aec08241d3a"],
  ["tools/spike.ts", "94fc4d83b13ba0f3cce8effdd388797b1376ffb34aa8d76bc590a1851d2533bf"],
  ["tools/session_fetch.ts", "5fb901c2fb4574bbf72f2bf15f3d4f5b278de029d6f18433d8907b9998feb09f"],
  ["rules/writing-and-output.md", "83565bd2d658d8a1c777dea41b4d8f0268e29db20b45e1ca16e0e4bbb54a3c42"],
].map(([relativePath, sha256]) => ({ relativePath, sha256, source: relativePath }));

const DIRECTORIES = [
  ["skills/cuddly-winner-feedback", "09848727872028bc24385e2531aab34ef1afcaf057c05942ac35c53cd5c89a6f"],
  ["skills/local-word-document", "bf69891a97eec9560bb633e839c3d6038f90c3b2ac2ebfcf1e2da639d409c058"],
  ["skills/project-agent-scaffolding", "e6f9bc487b0d46654837d7a57047e551dca5935c73bf93916fc04c1ddf8a2773"],
  ["skills/subagent-driven-development", "e3920537b79ace2c73e3c88e8a53949e9b857a1ec05966a3b5c9a9c89cc69a79"],
  ["skills/systematic-debugging", "dbace8d0bb6af7cf6499b7ec4814e62be9df04dc1a741a58cc9fb9e5a072bf49"],
  ["skills/test-driven-development", "3fc67b56570b1892ca13d91acd8f129a4aa33a98f99f6863be603942e33853d2"],
  ["skills/verification-before-completion", "3b5ebd466a055af606b1ebfd1ab648bb2cbb8358b8134d9b282926c5345c8bdb"],
  ["skills/writing-skills", "8080bfd5a3e78ea42f9d52364b1551f3d95a14ec0e9ced07d721e1e57740eff7"],
].map(([relativePath, sha256]) => ({ relativePath, sha256, source: relativePath }));

const PURGED_FILES = ["tools/publish_direct_agent.ts"];

const HISTORICAL = [
  { relativePath: "plugins/opencode-autonomous-supervisor.js", sha1: "c43313a21bb4c0a05bd3810079b5cad45b650340" },
  { relativePath: "tools/run.ts", sha1: "fec121e626de9da1776b0d8167174acb41c8168e" },
  {
    relativePath: "plugins/opencode-autonomous-supervisor",
    files: {
      "index.js": "e2a671b53677820427c10558b7cceeff932c3a6e",
      "package.json": "5f1c68d15f12f1ef34b8769cacf6319a1aa98fcd",
    },
  },
  { relativePath: "skills/playwright-image-generation", linkOnly: true },
];

function die(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const [action, ...rest] = argv;
  if (!['install', 'status', 'remove'].includes(action)) die('action must be install, status, or remove');
  let root = '';
  let repo = '';
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--root') root = rest[++index] ?? '';
    else if (rest[index] === '--repo') repo = rest[++index] ?? '';
    else die(`unknown argument: ${rest[index]}`);
  }
  if (!root || !repo) die('--root and --repo are required');
  return { action, root: path.resolve(root), repo: path.resolve(repo) };
}

function destination(root, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    die(`invalid retired asset path: ${relativePath}`);
  }
  const target = path.resolve(root, relativePath);
  const relation = path.relative(root, target);
  if (!relation || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    die(`retired asset path escapes configuration root: ${relativePath}`);
  }
  assertSafeParent(root, target);
  return target;
}

function lstatOrMissing(target) {
  try {
    return lstatSync(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

function assertSafeParent(root, target) {
  const rootStat = lstatOrMissing(root);
  if (!rootStat) return;
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    die(`unsafe retired asset root: ${root}`);
  }
  const parent = path.dirname(target);
  const relation = path.relative(root, parent);
  let current = root;
  for (const part of relation ? relation.split(path.sep) : []) {
    current = path.join(current, part);
    const stat = lstatOrMissing(current);
    if (!stat) return;
    if (stat.isSymbolicLink()) die(`symlinked retired asset parent: ${current}`);
    if (!stat.isDirectory()) die(`non-directory retired asset parent: ${current}`);
  }
}

function linkedTo(target, source) {
  const stat = lstatOrMissing(target);
  return Boolean(stat?.isSymbolicLink() && path.resolve(path.dirname(target), readlinkSync(target)) === path.resolve(source));
}

function fileHash(target, algorithm = 'sha256') {
  return createHash(algorithm).update(readFileSync(target)).digest('hex');
}

function gitBlobHash(target) {
  const content = readFileSync(target);
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
}

function directoryHash(target) {
  const hash = createHash('sha256');
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        const relativePath = path.relative(target, file).split(path.sep).join('/');
        hash.update(relativePath);
        hash.update('\0');
        hash.update(readFileSync(file));
        hash.update('\0');
      } else {
        throw new Error(`retired managed directory contains an unsafe entry: ${file}`);
      }
    }
  };
  walk(target);
  return hash.digest('hex');
}

function historicalDirectoryMatches(target, files) {
  const stat = lstatOrMissing(target);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) return false;
  const entries = readdirSync(target, { withFileTypes: true });
  if (entries.length !== Object.keys(files).length || entries.some((entry) => !entry.isFile() || !(entry.name in files))) return false;
  return entries.every((entry) => gitBlobHash(path.join(target, entry.name)) === files[entry.name]);
}

function currentAssetState(root, repo, asset, kind) {
  const target = destination(root, asset.relativePath);
  const source = path.join(repo, asset.source ?? asset.relativePath);
  const stat = lstatOrMissing(target);
  if (!stat) return { state: 'missing', target };
  if (linkedTo(target, source)) return { state: 'owned', target };
  if (asset.linkOnly) return { state: 'conflict', target };
  if (kind === 'file' && stat.isFile() && !stat.isSymbolicLink() && fileHash(target) === asset.sha256) return { state: 'owned', target };
  if (kind === 'directory' && stat.isDirectory() && !stat.isSymbolicLink() && directoryHash(target) === asset.sha256) return { state: 'owned', target };
  return { state: 'conflict', target };
}

function historicalAssetState(root, repo, asset) {
  const target = destination(root, asset.relativePath);
  const source = path.join(repo, asset.relativePath);
  const stat = lstatOrMissing(target);
  if (!stat) return { state: 'missing', target };
  if (linkedTo(target, source)) return { state: 'owned', target };
  if (asset.linkOnly) return { state: 'conflict', target };
  if (asset.sha1 && stat.isFile() && !stat.isSymbolicLink() && gitBlobHash(target) === asset.sha1) return { state: 'owned', target };
  if (asset.files && historicalDirectoryMatches(target, asset.files)) return { state: 'owned', target };
  return { state: 'conflict', target };
}

const { action, root, repo } = parseArgs(process.argv.slice(2));
let drift = false;
for (const asset of [
  ...FILES.map((entry) => ({ entry, kind: 'file' })),
  ...DIRECTORIES.map((entry) => ({ entry, kind: 'directory' })),
]) {
  const result = currentAssetState(root, repo, asset.entry, asset.kind);
  if (result.state === 'missing') continue;
  if (result.state === 'owned') {
    if (action === 'status') {
      process.stdout.write(`  [retired managed ${asset.kind}] ${result.target}\n`);
      drift = true;
    } else {
      rmSync(result.target, { recursive: asset.kind === 'directory', force: false });
      process.stdout.write(`Removed retired managed ${asset.kind}: ${result.target}\n`);
    }
  } else {
    process.stdout.write(`Retired asset conflict: ${result.target} (ownership not proven; preserved)\n`);
    if (action === 'status') drift = true;
  }
}

for (const relativePath of PURGED_FILES) {
  const target = destination(root, relativePath);
  const stat = lstatOrMissing(target);
  if (!stat) continue;
  if (!stat.isFile() && !stat.isSymbolicLink()) {
    process.stdout.write(`Retired file conflict: ${target} (not a file or symlink; preserved)\n`);
    if (action === 'status') drift = true;
    continue;
  }
  if (action === 'status') {
    process.stdout.write(`  [retired publisher present] ${target}\n`);
    drift = true;
  } else {
    rmSync(target, { force: false });
    process.stdout.write(`Purged retired publisher: ${target}\n`);
  }
}

for (const asset of HISTORICAL) {
  const result = historicalAssetState(root, repo, asset);
  if (result.state === 'missing') continue;
  if (result.state === 'owned') {
    if (action === 'status') {
      process.stdout.write(`  [retired managed artifact] ${result.target}\n`);
      drift = true;
    } else {
      rmSync(result.target, { recursive: Boolean(asset.files), force: false });
      process.stdout.write(`Removed retired managed artifact: ${result.target}\n`);
    }
  } else {
    process.stdout.write(`Retired artifact conflict: ${result.target} (ownership not proven; preserved)\n`);
    if (action === 'status') drift = true;
  }
}

process.exit(drift ? 1 : 0);
