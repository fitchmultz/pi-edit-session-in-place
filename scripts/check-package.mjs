import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SettingsManager, VERSION } from "@earendil-works/pi-coding-agent";

const root = fileURLToPath(new URL("..", import.meta.url));
const { name } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.ok(process.env.npm_execpath, "Run with npm run check:package");
const npm = (args) => execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
	cwd: root,
	encoding: "utf8",
});

process.env.PI_OFFLINE = "1";
mkdirSync(join(root, ".test-dist"), { recursive: true });
const temporary = mkdtempSync(join(root, ".test-dist/package-"));
try {
	const filename = npm(["pack", "--silent", "--offline", "--pack-destination", temporary]).trim();
	const consumer = join(temporary, "consumer");
	mkdirSync(consumer);
	writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true }));
	console.log(npm([
		"install", "--prefix", consumer, "--offline", "--omit=dev",
		"--no-audit", "--no-fund", "--no-save", "--package-lock=false", join(temporary, filename),
	]).trim());

	const installed = join(consumer, "node_modules", name);
	const loader = new DefaultResourceLoader({
		cwd: consumer,
		agentDir: join(temporary, "agent"),
		settingsManager: SettingsManager.inMemory(),
		additionalExtensionPaths: [installed],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	const { extensions, errors } = loader.getExtensions();
	assert.deepEqual(errors, [], "packed extension must load without errors");
	assert.equal(extensions.length, 1);
	assert.equal(
		realpathSync(extensions[0].resolvedPath),
		realpathSync(join(installed, "extensions/edit-session-in-place.ts")),
	);
	assert.ok(extensions[0].commands.has("edit-turn"), "packed extension must register /edit-turn");
	console.log(`Packed ${filename} loaded on Pi ${VERSION} (${import.meta.resolve("@earendil-works/pi-coding-agent")})`);
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
