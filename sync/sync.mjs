#!/usr/bin/env node
// Updates this repo's copy of bb's composer plugin to a new bb release tag.
//
// Usage: sync/sync.sh <tag>   (e.g. sync/sync.sh desktop-v0.49.0)
//
// For the tag recorded in UPSTREAM and the target tag, this script:
//   1. fetches just the needed parts of get-bb/bb at each tag,
//   2. builds each tag's standalone composer baseline (see baseline.mjs),
//   3. derives this repo's own changes as a patch: baseline(old) vs worktree,
//      excluding package.json, package-lock.json and repo-only files,
//   4. applies that patch on top of baseline(new) with a 3-way merge, stopping
//      before touching this repo on any conflict,
//   5. writes package.json = baseline(new) + this repo's metadata, updates
//      UPSTREAM, reinstalls dependencies, and typechecks/tests/builds.
//
// Set SYNC_SKIP_VERIFY=1 to skip step 5's install/checks (used by tests).
// Committing the result is left to the human.
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBaseline, mergePackageJson, readJson, writeJson } from "./baseline.mjs";

const UPSTREAM_REPO = "https://github.com/get-bb/bb.git";
// Exactly the trees/files the baseline builder reads. Keep in sync with
// sync/baseline.mjs.
const FETCH_PATHS = [
  "plugins/composer",
  "packages/plugin-registry",
  "packages/plugin-build/src/runtime-shims.mjs",
  "scripts/lib/plugin-fork.mjs",
  "packages/plugin-sdk/package.json",
  "apps/app/package.json",
];
// Repo-only files the plugin patch must never carry, and that updating the
// plugin tree must never delete. package.json is merged separately.
const PROTECTED = new Set([
  ".gitignore",
  "LICENSE",
  "README.md",
  "UPSTREAM",
  "package-lock.json",
  "package.json",
  "sync",
]);
const SKIP = new Set([".git", "dist", "node_modules"]);

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const newTag = process.argv[2];
if (newTag === undefined || !/^desktop-v\d+\.\d+\.\d+$/.test(newTag)) {
  console.error("Usage: sync/sync.sh <tag>   (e.g. sync/sync.sh desktop-v0.49.0)");
  process.exit(2);
}

function run(cmd, args, { cwd = root, capture = false } = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with exit ${result.status}`);
  }
  return result.stdout;
}

// Copies src's files over dst. With delete, removes dst entries that src
// does not have (top-level names in PROTECTED and SKIP are never touched).
async function overlay(src, dst, { delete: doDelete = false, protect = new Set() } = {}) {
  if (doDelete) {
    for (const entry of await readdir(dst, { withFileTypes: true })) {
      if (SKIP.has(entry.name) || protect.has(entry.name)) continue;
      if (!existsSync(join(src, entry.name))) {
        await rm(join(dst, entry.name), { recursive: true, force: true });
      }
    }
  }
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || protect.has(entry.name)) continue;
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    if (entry.isDirectory()) {
      await mkdir(to, { recursive: true });
      await overlay(from, to, { delete: doDelete });
    } else {
      await cp(from, to, { force: true });
    }
  }
}

async function fetchUpstream(tag, dir) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  run("git", ["init", "-q"], { cwd: dir });
  run("git", ["remote", "add", "origin", UPSTREAM_REPO], { cwd: dir });
  run("git", ["fetch", "--depth", "1", "--filter=blob:none", "origin", `refs/tags/${tag}`], {
    cwd: dir,
  });
  run("git", ["restore", "--source=FETCH_HEAD", "--worktree", "--staged", "--", ...FETCH_PATHS], {
    cwd: dir,
  });
}

const status = run("git", ["status", "--porcelain"], { capture: true });
if (status.trim() !== "") {
  console.error("Refusing to run on a dirty git tree; commit or stash first:");
  console.error(status);
  process.exit(1);
}
const previousTag = (await readFile(join(root, "UPSTREAM"), "utf8")).trim();
if (!/^desktop-v\d+\.\d+\.\d+$/.test(previousTag)) {
  console.error(`UPSTREAM does not name a bb tag: ${previousTag}`);
  process.exit(1);
}
const previousManifest = await readJson(join(root, "package.json"));

const tmp = await mkdtemp(join(tmpdir(), "composer-voice-sync-"));
try {
  console.log(`Fetching get-bb/bb ${previousTag} and ${newTag}...`);
  const oldTree = join(tmp, "upstream-old");
  const newTree = join(tmp, "upstream-new");
  await fetchUpstream(previousTag, oldTree);
  if (newTag === previousTag) {
    await cp(oldTree, newTree, { recursive: true });
  } else {
    await fetchUpstream(newTag, newTree);
  }

  console.log("Building baselines...");
  const baselineOld = join(tmp, "baseline-old");
  const baselineNew = join(tmp, "baseline-new");
  await buildBaseline(oldTree, baselineOld);
  await buildBaseline(newTree, baselineNew);

  console.log("Deriving this repo's changes from the current tree...");
  const scratch = join(tmp, "scratch");
  await mkdir(scratch);
  run("git", ["init", "-q"], { cwd: scratch });
  await overlay(baselineOld, scratch);
  run("git", ["add", "-A"], { cwd: scratch });
  run(
    "git",
    ["-c", "user.name=sync", "-c", "user.email=sync@invalid", "commit", "-qm", "baseline-old"],
    { cwd: scratch },
  );
  // Overlay the repo's plugin files (protecting repo-only files).
  await overlay(root, scratch, { delete: true, protect: PROTECTED });
  run("git", ["add", "-A"], { cwd: scratch });
  const patch = run("git", ["diff", "--cached", "--binary", "HEAD"], {
    cwd: scratch,
    capture: true,
  });
  const patchPath = join(tmp, "repo-changes.patch");
  await writeFile(patchPath, patch);
  console.log(`Collected ${patch.length} bytes of repo changes.`);

  // Reset the scratch tree to the new baseline and re-apply our changes.
  // git apply --3way needs the index to match the worktree, so re-stage it.
  await overlay(baselineNew, scratch, { delete: true });
  run("git", ["add", "-A"], { cwd: scratch });
  const apply = spawnSync("git", ["apply", "--3way", patchPath], {
    cwd: scratch,
    encoding: "utf8",
  });
  if (apply.status !== 0) {
    console.error("The repo's changes conflict with the new upstream tree:");
    console.error(apply.stdout?.trim());
    console.error(apply.stderr?.trim());
    console.error(`This repo was not modified. The patch is kept at ${patchPath};`);
    console.error("resolve the conflict by hand from there.");
    process.exit(1);
  }

  console.log("Merging package.json metadata...");
  const merged = mergePackageJson(
    await readJson(join(baselineNew, "package.json")),
    previousManifest,
    newTag,
  );
  await writeJson(join(scratch, "package.json"), merged);

  console.log(`Updating plugin tree to ${newTag}...`);
  await overlay(scratch, root, {
    delete: true,
    protect: new Set([...PROTECTED].filter((name) => name !== "package.json")),
  });
  await writeFile(join(root, "UPSTREAM"), `${newTag}\n`);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

if (process.env.SYNC_SKIP_VERIFY !== "1") {
  run("npm", ["install", "--ignore-scripts"]);
  run("npm", ["run", "typecheck"]);
  run("npm", ["test"]);
  run("bb", ["plugin", "build", "."]);
}
console.log(`Synced to ${newTag}. Review the diff and commit.`);
