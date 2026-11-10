// Builds a standalone baseline of bb's composer plugin from an upstream
// get-bb/bb tree, mirroring what the bb monorepo's fork tooling produces:
//
//   - a copy of plugins/composer,
//   - the component-registry UI it imports, vendored next to it,
//   - a package.json/tsconfig that install and typecheck outside the bb
//     workspace (workspace deps resolved to published versions).
//
// Usage: node sync/baseline.mjs <upstream-tree> <out-dir>
//
// <out-dir> must not exist or be empty; it is then fully (re)written.
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

// The SDK version pinned in the forked package.json comes from the upstream
// tree's own packages/plugin-sdk, so each bb tag vendors its matching SDK.
export async function buildBaseline(upstream, out) {
  upstream = resolve(upstream);
  out = resolve(out);
  if (existsSync(out) && (await readdir(out)).length > 0) {
    throw new Error(`refusing to build into non-empty directory ${out}`);
  }
  const pluginDir = join(upstream, "plugins", "composer");

  const fork = await import(
    pathToFileURL(join(upstream, "scripts", "lib", "plugin-fork.mjs")).href
  );
  const { SHIMMED_TYPE_PACKAGES } = await import(
    pathToFileURL(
      join(upstream, "packages", "plugin-build", "src", "runtime-shims.mjs"),
    ).href
  );

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(pluginDir, out, { recursive: true });

  const specifiers = new Set();
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (["node_modules", "dist", ".turbo"].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await collect(path);
      else if (/\.(?:ts|tsx)$/.test(entry.name)) {
        for (const specifier of fork.registryAliasImports(
          await readFile(path, "utf8"),
        )) {
          specifiers.add(specifier);
        }
      }
    }
  }
  await collect(out);

  const registryDirectory = join(upstream, "packages", "plugin-registry", "r");
  const registry = await Promise.all(
    (await readdir(registryDirectory))
      .filter((name) => name.endsWith(".json") && name !== "index.json")
      .map((name) => readJson(join(registryDirectory, name))),
  );
  const items = fork.registryItemsForImports(specifiers, registry);
  const vendorRoots = new Set();
  for (const item of items) {
    for (const file of item.files) {
      const path = join(out, file.target);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content);
      vendorRoots.add(file.target.split("/")[0]);
    }
  }

  const sdkSpecifier = (
    await readJson(join(upstream, "packages", "plugin-sdk", "package.json"))
  ).version;
  const registryManifest = await readJson(
    join(upstream, "packages", "plugin-registry", "package.json"),
  );
  const appManifest = await readJson(
    join(upstream, "apps", "app", "package.json"),
  );
  const forked = fork.forkPluginPackageJson(
    await readJson(join(out, "package.json")),
    {
      sdkSpecifier,
      workspaceBinsByPackage: new Map([
        ["@bb/plugin-build", ["bb-plugin-build"]],
      ]),
      registryDependencies: fork.registryPackages(items, {
        shimmedPackages: new Set(SHIMMED_TYPE_PACKAGES),
        versions: {
          ...registryManifest.devDependencies,
          ...appManifest.devDependencies,
          ...appManifest.dependencies,
        },
      }),
    },
  );
  await writeJson(join(out, "package.json"), forked.manifest);

  const tsconfig = fork.forkPluginTsconfig(
    await readJson(join(out, "tsconfig.json")),
  );
  tsconfig.include = [
    ...new Set([...tsconfig.include, ...[...vendorRoots].sort()]),
  ];
  await writeJson(join(out, "tsconfig.json"), tsconfig);

  return { vendoredItems: items.length };
}

// The repo's package.json is the new baseline's manifest with this repo's
// metadata carried forward and engines.bb derived from the target tag.
const PRESERVED_ROOT_FIELDS = ["name", "version", "description", "repository"];
const PRESERVED_BB_FIELDS = ["name", "description"];

export function mergePackageJson(baseline, previous, tag) {
  const merged = structuredClone(baseline);
  for (const field of PRESERVED_ROOT_FIELDS) {
    if (previous[field] !== undefined) merged[field] = previous[field];
  }
  if (previous.bb !== undefined) {
    for (const field of PRESERVED_BB_FIELDS) {
      if (previous.bb[field] !== undefined) merged.bb[field] = previous.bb[field];
    }
  }
  const match = /^desktop-v(\d+)\.(\d+)\.\d+$/.exec(tag);
  if (match === null) {
    throw new Error(`not a bb desktop tag: ${tag}`);
  }
  merged.engines ??= {};
  merged.engines.bb = `>=${match[1]}.${match[2]}.0 <${match[1]}.${Number(match[2]) + 1}.0`;
  return merged;
}

if (
  process.argv[2] !== undefined &&
  process.argv[3] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { vendoredItems } = await buildBaseline(process.argv[2], process.argv[3]);
  console.log(`Vendored ${vendoredItems} registry items into ${process.argv[3]}`);
}
