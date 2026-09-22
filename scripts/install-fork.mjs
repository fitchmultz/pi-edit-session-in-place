import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

assert.equal(process.argv.length, 3, "Usage: node scripts/install-fork.mjs <built-fork-checkout>");
const root = fileURLToPath(new URL("..", import.meta.url));
const fork = resolve(process.argv[2]);
const { getPublicWorkspacePackages } = await import(pathToFileURL(join(fork, "scripts/release-packages.mjs")));
const { packReleasePackages } = await import(pathToFileURL(join(fork, "scripts/coding-agent-consumer.mjs")));
const packages = getPublicWorkspacePackages(join(fork, "packages"));
const packagesByName = new Map(packages.map((pkg) => [pkg.name, pkg]));
const tarballs = packReleasePackages(packages, join(fork, ".artifacts/compatibility"));
const specs = Object.fromEntries([...tarballs].map(([name, tarball]) => [name, `file:${tarball}`]));
const manifestPath = join(root, "package.json");
const original = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(original);
const required = new Set();
for (const name of Object.keys(manifest.devDependencies)) {
	if (!specs[name]) continue;
	manifest.devDependencies[name] = specs[name];
	required.add(name);
}

try {
	// Override shrinkwrapped registry dependencies as well as the direct SDK imports.
	writeFileSync(manifestPath, JSON.stringify({
		...manifest,
		overrides: { ...manifest.overrides, ...specs },
	}));
	execFileSync("npm", ["install", "--ignore-scripts", "--no-save", "--package-lock=false", "--no-audit", "--no-fund"], {
		cwd: root,
		stdio: "inherit",
	});
} finally {
	writeFileSync(manifestPath, original);
}

for (const name of required) {
	const pkg = packagesByName.get(name);
	const sourceManifest = JSON.parse(readFileSync(join(pkg.directory, "package.json"), "utf8"));
	for (const dependency of Object.keys(sourceManifest.dependencies ?? {})) {
		if (packagesByName.has(dependency)) required.add(dependency);
	}
	const installed = join(root, "node_modules", pkg.name);
	const installedManifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
	assert.equal(installedManifest.name, pkg.name);
	assert.equal(installedManifest.version, pkg.version);
	const entries = ["dist/index.js"];
	if (pkg.name === "@earendil-works/pi-coding-agent") entries.push("dist/bundle/cli.js");
	for (const entry of entries) {
		assert.ok(readFileSync(join(installed, entry)).equals(readFileSync(join(pkg.directory, entry))), `${pkg.name}: ${entry} must match the built fork`);
	}
	console.log(`Verified fork SDK: ${pkg.name}@${pkg.version}`);
}
