/**
 * Purpose: Regression coverage for editable-message extraction and external-editor helper behavior.
 * Responsibilities: Verify ordering/filtering, image warnings, command parsing, env resolution, and editor output trimming.
 * Scope: Pure helper and low-level behavior tests only; no interactive TUI integration.
 * Usage: Run via `npm test` after compiling test fixtures to `.test-dist`.
 * Invariants/Assumptions: Tests target the published extension entrypoint shape and current pi helper behavior.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

import editSessionInPlace, {
	extractEditableText,
	formatTimestamp,
	getEditableMessages,
	getEditTurnCommandText,
	getExpandedEditorText,
	parseExternalEditorCommand,
	resolveExternalEditorCommand,
	trimSingleTrailingNewline,
} from "../extensions/edit-session-in-place.js";

const baseTimestamp = "2026-04-07T12:00:00.000Z";

const branch = [
	{
		type: "message",
		id: "u1",
		parentId: null,
		timestamp: baseTimestamp,
		message: {
			role: "user",
			content: [{ type: "text", text: "First prompt" }],
		},
	},
	{
		type: "message",
		id: "a1",
		parentId: "u1",
		timestamp: "2026-04-07T12:00:05.000Z",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "Reply" }],
		},
	},
	{
		type: "message",
		id: "u2",
		parentId: "a1",
		timestamp: "2026-04-07T12:01:00.000Z",
		message: {
			role: "user",
			content: [{ type: "image", data: "abc", mimeType: "image/png" }],
		},
	},
	{
		type: "message",
		id: "u3",
		parentId: "u2",
		timestamp: "2026-04-07T12:02:00.000Z",
		message: {
			role: "user",
			content: [{ type: "text", text: "   \n  " }],
		},
	},
	{
		type: "message",
		id: "u4",
		parentId: "u3",
		timestamp: "2026-04-07T12:03:00.000Z",
		message: {
			role: "user",
			content: [
				{ type: "text", text: "Second prompt with image" },
				{ type: "image", data: "def", mimeType: "image/png" },
			],
		},
	},
	{
		type: "message",
		id: "u5",
		parentId: "u4",
		timestamp: "2026-04-07T12:04:00.000Z",
		message: {
			role: "user",
			content: [{ type: "text", text: "Latest prompt" }],
		},
	},
] as Parameters<typeof getEditableMessages>[0];

test("extractEditableText keeps plain strings and mixed text+image content", () => {
	assert.deepEqual(extractEditableText("hello"), { text: "hello", hasImages: false });

	const mixed = extractEditableText([
		{ type: "text", text: "hello" },
		{ type: "image", data: "abc", mimeType: "image/png" },
		{ type: "text", text: "world" },
	]);
	assert.equal(mixed.text, "hello\nworld");
	assert.equal(mixed.hasImages, true);
});

test("getEditableMessages keeps oldest-to-newest order and skips non-editable user messages", () => {
	const messages = getEditableMessages(branch);

	assert.deepEqual(
		messages.map((message) => message.entryId),
		["u1", "u4", "u5"],
		"picker should keep oldest-to-newest order and skip non-editable user messages",
	);
	assert.equal(messages[0]?.text, "First prompt");
	assert.equal(messages[1]?.hasImages, true, "mixed text+image message should keep image warning flag");
	assert.equal(messages[2]?.text, "Latest prompt");
	const expectedLatestLabel = `3. ${formatTimestamp("2026-04-07T12:04:00.000Z")} — Latest prompt`;
	assert.equal(messages[2]?.label, expectedLatestLabel);
});

test("getEditableMessages can include assistant text when requested", () => {
	const messages = getEditableMessages(branch, { includeAssistant: true });

	assert.deepEqual(
		messages.map((message) => [message.entryId, message.role]),
		[
			["u1", "user"],
			["a1", "assistant"],
			["u4", "user"],
			["u5", "user"],
		],
	);
	assert.equal(messages[1]?.text, "Reply");
	assert.match(messages[1]?.label ?? "", /assistant — Reply$/);
});

// Run the compiled formatTimestamp under a fixed TZ in a child process. Node pins the
// timezone at startup from the environment, so a subprocess is the reliable way to assert
// concrete local-time output regardless of the contributor's machine timezone.
const compiledExtensionPath = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"../extensions/edit-session-in-place.js",
);
const formatTimestampAtTz = (tz: string, ...inputs: string[]) => {
	const script = `import { formatTimestamp } from ${JSON.stringify(
		pathToFileURL(compiledExtensionPath).href,
	)}; process.stdout.write(JSON.stringify(${JSON.stringify(inputs)}.map(formatTimestamp)));`;
	const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
		env: { ...process.env, TZ: tz },
		encoding: "utf-8",
	});
	assert.equal(result.status, 0, `formatTimestamp subprocess failed for TZ=${tz}: ${result.stderr}`);
	return JSON.parse(result.stdout) as string[];
};

test("formatTimestamp renders local time under fixed timezones with concrete expected values", () => {
	const instant = "2026-04-07T12:04:00.000Z";

	// UTC: no offset.
	assert.deepEqual(formatTimestampAtTz("UTC", instant), ["2026-04-07 12:04"]);
	// America/New_York in April is EDT (UTC-4).
	assert.deepEqual(formatTimestampAtTz("America/New_York", instant), ["2026-04-07 08:04"]);
	// Pacific/Auckland in April is NZST (UTC+12): the instant rolls into the next day.
	assert.deepEqual(formatTimestampAtTz("Pacific/Auckland", instant), ["2026-04-08 00:04"]);
});

test("formatTimestamp falls back to the raw slice for malformed timestamps and pads single-digit fields", () => {
	// Malformed input: no Date math applies, returns the raw slice (machine-independent).
	assert.equal(formatTimestamp("bad"), "bad");
	assert.equal(formatTimestamp(""), "");

	// Single-digit month/day/hour/minute all pad to two digits. January 2, 00:05 UTC.
	assert.deepEqual(formatTimestampAtTz("UTC", "2026-01-02T00:05:00.000Z"), ["2026-01-02 00:05"]);
});

test("resolveExternalEditorCommand prefers VISUAL and ignores blank values", () => {
	assert.equal(resolveExternalEditorCommand({ VISUAL: "  code --wait  ", EDITOR: "vim" }), "code --wait");
	assert.equal(resolveExternalEditorCommand({ VISUAL: "   ", EDITOR: "  nvim -f  " }), "nvim -f");
	assert.equal(resolveExternalEditorCommand({ VISUAL: "", EDITOR: "" }), undefined);
});

test("parseExternalEditorCommand handles quoted executables and shell-style escaping", () => {
	assert.deepEqual(parseExternalEditorCommand("code --wait --reuse-window"), {
		executable: "code",
		args: ["--wait", "--reuse-window"],
	});

	assert.deepEqual(
		parseExternalEditorCommand('"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --wait'),
		{
			executable: "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
			args: ["--wait"],
		},
	);

	assert.deepEqual(parseExternalEditorCommand("code\\ insiders --wait ''"), {
		executable: "code insiders",
		args: ["--wait", ""],
	});

	assert.deepEqual(parseExternalEditorCommand("C:\\Windows\\System32\\notepad.exe"), {
		executable: "C:\\Windows\\System32\\notepad.exe",
		args: [],
	});

	assert.deepEqual(parseExternalEditorCommand('"C:\\Program Files\\Vim\\vim.exe" -f'), {
		executable: "C:\\Program Files\\Vim\\vim.exe",
		args: ["-f"],
	});
});

test("parseExternalEditorCommand rejects unterminated quotes", () => {
	assert.throws(() => parseExternalEditorCommand('"code --wait'), /Unterminated quote/);
});

test("trimSingleTrailingNewline removes only one final newline", () => {
	assert.equal(trimSingleTrailingNewline("hello\n"), "hello");
	assert.equal(trimSingleTrailingNewline("hello\r\n"), "hello");
	assert.equal(trimSingleTrailingNewline("hello\n\n"), "hello\n");
	assert.equal(trimSingleTrailingNewline("hello"), "hello");
});

test("getExpandedEditorText prefers marker-expanded editor content", () => {
	assert.equal(
		getExpandedEditorText({
			getText: () => "[paste #1 +20 lines]",
			getExpandedText: () => "expanded paste content",
		}),
		"expanded paste content",
	);
	assert.equal(getExpandedEditorText({ getText: () => "plain editor content" }), "plain editor content");
});

test("getEditTurnCommandText uses the latest suffixed invocation when duplicate packages are loaded", () => {
	assert.equal(getEditTurnCommandText([]), "/edit-turn");
	assert.equal(getEditTurnCommandText([{ name: "edit-turn" }]), "/edit-turn");
	assert.equal(
		getEditTurnCommandText([{ name: "edit-turn:1" }, { name: "other" }, { name: "edit-turn:2" }]),
		"/edit-turn:2",
	);
});

test("extension does not register a shortcut handler that can consume the editor hotkey", () => {
	let sessionStartHandler: ((event: unknown, ctx: any) => void) | undefined;
	let editorFactory: unknown;
	let registeredShortcut = false;

	editSessionInPlace({
		registerCommand() {},
		registerShortcut() {
			registeredShortcut = true;
		},
		on(event: string, handler: (event: unknown, ctx: any) => void) {
			if (event === "session_start") {
				sessionStartHandler = handler;
			}
		},
	} as any);

	sessionStartHandler?.({}, {
		mode: "tui",
		ui: {
			getEditorComponent: () => undefined,
			setEditorComponent: (factory: unknown) => {
				editorFactory = factory;
			},
		},
	});

	assert.equal(registeredShortcut, false);
	assert.equal(typeof editorFactory, "function", "TUI sessions should install the custom editor hotkey path");
});

test("custom editor hotkey wraps existing editors and restores expanded drafts", async () => {
	let sessionStartHandler: ((event: unknown, ctx: any) => void) | undefined;
	let commandHandler: ((args: string, ctx: any) => Promise<void>) | undefined;
	let editorFactory: ((tui: unknown, theme: unknown, keybindings: any) => any) | undefined;
	let previousFactoryCalled = false;
	const baseActionHandlers = new Map();
	const setTextCalls: string[] = [];
	const handledInputs: string[] = [];
	const baseEditor = {
		actionHandlers: baseActionHandlers,
		getText: () => "[paste #1 +20 lines]",
		getExpandedText: () => "expanded draft",
		setText: (text: string) => {
			setTextCalls.push(text);
		},
		handleInput: (data: string) => {
			handledInputs.push(data);
		},
		render: () => [],
		invalidate() {},
	};

	editSessionInPlace({
		registerCommand(name: string, options: { handler: (args: string, ctx: any) => Promise<void> }) {
			if (name === "edit-turn") {
				commandHandler = options.handler;
			}
		},
		registerShortcut() {},
		on(event: string, handler: (event: unknown, ctx: any) => void) {
			if (event === "session_start") {
				sessionStartHandler = handler;
			}
		},
		getCommands: () => [{ name: "edit-turn" }],
	} as any);

	sessionStartHandler?.({}, {
		mode: "tui",
		ui: {
			getEditorComponent: () => () => {
				previousFactoryCalled = true;
				return baseEditor;
			},
			setEditorComponent: (factory: typeof editorFactory) => {
				editorFactory = factory;
			},
		},
	});

	const editor = editorFactory?.({}, {}, { matches: () => false });
	editor?.onAction("app.interrupt", () => undefined);
	editor?.handleInput("\x1b[69;6u");

	let restoredDraft: string | undefined;
	await commandHandler?.("", {
		mode: "tui",
		hasPendingMessages: () => false,
		isIdle: () => true,
		sessionManager: { getBranch: () => [] },
		ui: {
			notify() {},
			setEditorText: (text: string) => {
				restoredDraft = text;
			},
		},
	});

	assert.equal(previousFactoryCalled, true, "hotkey editor should wrap an existing custom editor factory");
	assert.deepEqual(setTextCalls, ["/edit-turn"]);
	assert.deepEqual(handledInputs, ["\r"]);
	assert.equal(restoredDraft, "expanded draft");
	assert.equal(baseActionHandlers.has("app.interrupt"), true, "app action handlers should be delegated to CustomEditor-like bases");
});
