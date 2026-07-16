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

import { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import editSessionInPlace, {
	editAssistantMessage,
	extractEditableText,
	formatTimestamp,
	getEditableMessages,
	getEditTurnCommandText,
	getExpandedEditorText,
	getWritableSessionManagerAdapter,
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
		[["u1", "user"], ["a1", "assistant"], ["u4", "user"], ["u5", "user"]],
	);
});

const assistantMessage = (text: string) => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "test",
	provider: "test",
	model: "test",
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop",
	timestamp: 1,
});

const makeRealPiHarness = (cancelNavigation?: (call: number, targetId: string) => boolean) => {
	const manager = SessionManager.inMemory();
	const promptId = manager.appendMessage({ role: "user", content: [{ type: "text", text: "Keep this prompt" }], timestamp: 1 } as any);
	const assistantId = manager.appendMessage(assistantMessage("Old response") as any);
	manager.appendMessage({ role: "user", content: [{ type: "text", text: "Later prompt" }], timestamp: 2 } as any);
	const oldLeafId = manager.appendMessage(assistantMessage("Later response") as any);
	let navigationCalls = 0;
	const runtime = Object.assign(Object.create(AgentSession.prototype), {
		sessionManager: manager,
		agent: { state: { messages: manager.buildSessionContext().messages } },
		_extensionRunner: {
			hasHandlers: (event: string) => event === "session_before_tree",
			emit: async (event: any) => {
				if (event.type !== "session_before_tree") return undefined;
				navigationCalls += 1;
				return cancelNavigation?.(navigationCalls, event.preparation.targetId) ? { cancel: true } : undefined;
			},
		},
		_branchSummaryAbortController: undefined,
	}) as any;
	const navigateTree = (targetId: string, options?: { summarize?: boolean }) =>
		AgentSession.prototype.navigateTree.call(runtime, targetId, options);
	const ctx = { sessionManager: manager, navigateTree, ui: { notify() {} } } as any;
	const selected = getEditableMessages(manager.getBranch(), { includeAssistant: true }).find(
		(message) => message.entryId === assistantId,
	);
	assert.ok(selected);
	return { manager, runtime, ctx, selected, promptId, oldLeafId, getNavigationCalls: () => navigationCalls };
};

const assertRuntimeSynchronized = (manager: SessionManager, runtime: any) => {
	assert.deepEqual(runtime.agent.state.messages, manager.buildSessionContext().messages);
};

test("assistant edit follows real Pi 0.80.9 user-target navigation and preserves the prompt", async () => {
	const { manager, runtime, ctx, selected } = makeRealPiHarness();
	assert.equal(await editAssistantMessage(ctx, selected, "New response"), true);

	const active = manager.getBranch();
	assert.deepEqual(active.map((entry) => entry.type === "message" ? entry.message.role : entry.type), ["user", "assistant"]);
	assert.equal((active[0] as any).message.content[0].text, "Keep this prompt");
	assert.equal((active[1] as any).message.content[0].text, "New response");
	assertRuntimeSynchronized(manager, runtime);
});

test("assistant delete follows real Pi 0.80.9 semantics and keeps the prompt in live context", async () => {
	const { manager, runtime, ctx, selected } = makeRealPiHarness();
	assert.equal(await editAssistantMessage(ctx, selected, ""), true);

	assert.deepEqual(manager.getBranch().map((entry) => entry.type === "message" ? entry.message.role : entry.type), ["user", "custom"]);
	assert.equal((manager.getBranch()[0] as any).message.content[0].text, "Keep this prompt");
	assertRuntimeSynchronized(manager, runtime);
});

const makeToolResultHarness = (cancelNavigation?: (call: number, targetId: string) => boolean) => {
	const manager = SessionManager.inMemory();
	const promptId = manager.appendMessage({ role: "user", content: [{ type: "text", text: "Use the tool" }], timestamp: 1 } as any);
	const toolAssistantId = manager.appendMessage({
		...assistantMessage(""),
		content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } }],
		stopReason: "toolUse",
	} as any);
	const toolResultId = manager.appendMessage({
		role: "toolResult",
		toolCallId: "call-1",
		toolName: "read",
		content: [{ type: "text", text: "file contents" }],
		isError: false,
		timestamp: 2,
	} as any);
	const selectedId = manager.appendMessage(assistantMessage("Final response") as any);
	manager.appendMessage({ role: "user", content: [{ type: "text", text: "Later prompt" }], timestamp: 3 } as any);
	const oldLeafId = manager.appendMessage(assistantMessage("Later response") as any);
	let navigationCalls = 0;
	const runtime = Object.assign(Object.create(AgentSession.prototype), {
		sessionManager: manager,
		agent: { state: { messages: manager.buildSessionContext().messages } },
		_extensionRunner: {
			hasHandlers: (event: string) => event === "session_before_tree",
			emit: async (event: any) => {
				if (event.type !== "session_before_tree") return undefined;
				navigationCalls += 1;
				return cancelNavigation?.(navigationCalls, event.preparation.targetId) ? { cancel: true } : undefined;
			},
		},
		_branchSummaryAbortController: undefined,
	}) as any;
	const ctx = {
		sessionManager: manager,
		navigateTree: (targetId: string, options?: { summarize?: boolean }) =>
			AgentSession.prototype.navigateTree.call(runtime, targetId, options),
		ui: { notify() {} },
	} as any;
	const selected = getEditableMessages(manager.getBranch(), { includeAssistant: true }).find(
		(message) => message.entryId === selectedId,
	);
	assert.ok(selected);
	return {
		manager,
		runtime,
		ctx,
		selected,
		promptId,
		toolAssistantId,
		toolResultId,
		oldLeafId,
		getNavigationCalls: () => navigationCalls,
	};
};

for (const [operation, text] of [["edit", "Rewritten final response"], ["delete", ""]] as const) {
	test(`assistant ${operation} preserves user→assistant(tool)→toolResult under real Pi 0.80.9 navigation`, async () => {
		const { manager, runtime, ctx, selected, promptId, toolAssistantId, toolResultId } = makeToolResultHarness();
		assert.equal(await editAssistantMessage(ctx, selected, text), true);

		const active = manager.getBranch();
		assert.deepEqual(active.slice(0, 3).map((entry) => entry.id), [promptId, toolAssistantId, toolResultId]);
		assert.deepEqual(active.map((entry) => entry.type === "message" ? entry.message.role : entry.type),
			operation === "edit" ? ["user", "assistant", "toolResult", "assistant"] : ["user", "assistant", "toolResult", "custom"]);
		assertRuntimeSynchronized(manager, runtime);
	});
}

for (const parentKind of ["custom-entry", "custom-role", "compaction", "metadata"] as const) {
	test(`assistant edit preserves a preceding ${parentKind} entry and its branch`, async () => {
		const manager = SessionManager.inMemory();
		const promptId = manager.appendMessage({ role: "user", content: "Prompt", timestamp: 1 } as any);
		const precursorId = manager.appendMessage(assistantMessage("Intermediate") as any);
		const parentId = parentKind === "custom-entry"
			? manager.appendCustomEntry("fixture", { keep: true })
			: parentKind === "custom-role"
				? manager.appendMessage({ role: "custom", customType: "fixture", content: "context", display: false, timestamp: 2 } as any)
				: parentKind === "compaction"
					? manager.appendCompaction("summary", promptId, 10)
					: manager.appendSessionInfo("fixture");
		const selectedId = manager.appendMessage(assistantMessage("Final") as any);
		manager.appendMessage({ role: "user", content: "Later", timestamp: 3 } as any);
		manager.appendMessage(assistantMessage("Later response") as any);
		const runtime = Object.assign(Object.create(AgentSession.prototype), {
			sessionManager: manager,
			agent: { state: { messages: manager.buildSessionContext().messages } },
			_extensionRunner: { hasHandlers: () => false, emit: async () => undefined },
			_branchSummaryAbortController: undefined,
		}) as any;
		const selected = getEditableMessages(manager.getBranch(), { includeAssistant: true }).find(
			(message) => message.entryId === selectedId,
		);
		assert.ok(selected);
		const ctx = {
			sessionManager: manager,
			navigateTree: (targetId: string, options?: { summarize?: boolean }) =>
				AgentSession.prototype.navigateTree.call(runtime, targetId, options),
			ui: { notify() {} },
		} as any;

		assert.equal(await editAssistantMessage(ctx, selected, "Rewritten"), true);
		assert.deepEqual(manager.getBranch().slice(0, 3).map((entry) => entry.id), [promptId, precursorId, parentId]);
		assertRuntimeSynchronized(manager, runtime);
	});
}

test("assistant edit replays a custom-message parent dropped by Pi navigation", async () => {
	const manager = SessionManager.inMemory();
	const promptId = manager.appendMessage({ role: "user", content: "Prompt", timestamp: 1 } as any);
	manager.appendCustomMessageEntry("fixture", "custom context", false, { keep: true });
	const selectedId = manager.appendMessage(assistantMessage("Final") as any);
	manager.appendMessage({ role: "user", content: "Later", timestamp: 3 } as any);
	manager.appendMessage(assistantMessage("Later response") as any);
	const runtime = Object.assign(Object.create(AgentSession.prototype), {
		sessionManager: manager,
		agent: { state: { messages: manager.buildSessionContext().messages } },
		_extensionRunner: { hasHandlers: () => false, emit: async () => undefined },
		_branchSummaryAbortController: undefined,
	}) as any;
	const selected = getEditableMessages(manager.getBranch(), { includeAssistant: true }).find(
		(message) => message.entryId === selectedId,
	);
	assert.ok(selected);
	const ctx = {
		sessionManager: manager,
		navigateTree: (targetId: string, options?: { summarize?: boolean }) =>
			AgentSession.prototype.navigateTree.call(runtime, targetId, options),
		ui: { notify() {} },
	} as any;

	assert.equal(await editAssistantMessage(ctx, selected, "Rewritten"), true);
	const active = manager.getBranch();
	assert.equal(active[0]?.id, promptId);
	assert.deepEqual(active.slice(1).map((entry) => entry.type), ["custom_message", "message"]);
	assert.equal((active[1] as any).content, "custom context");
	assert.deepEqual((active[1] as any).details, { keep: true });
	assertRuntimeSynchronized(manager, runtime);
});

test("incompatible writable adapter is rejected before real Pi navigation or mutation", async () => {
	const { manager, ctx, selected, oldLeafId, getNavigationCalls } = makeRealPiHarness();
	const entryCount = manager.getEntries().length;
	ctx.sessionManager = {
		getEntry: manager.getEntry.bind(manager),
		getLeafId: manager.getLeafId.bind(manager),
		appendMessage: manager.appendMessage.bind(manager),
		appendCustomEntry: manager.appendCustomEntry.bind(manager),
	};

	assert.equal(await editAssistantMessage(ctx, selected, "New response"), false);
	assert.equal(getNavigationCalls(), 0);
	assert.equal(manager.getEntries().length, entryCount);
	assert.equal(manager.getLeafId(), oldLeafId);
});

test("first navigation cancellation leaves real Pi runtime untouched", async () => {
	const { manager, runtime, ctx, selected, oldLeafId } = makeRealPiHarness((call) => call === 1);
	const entries = manager.getEntries();
	const messages = structuredClone(runtime.agent.state.messages);

	assert.equal(await editAssistantMessage(ctx, selected, "New response"), false);
	assert.deepEqual(manager.getEntries(), entries);
	assert.equal(manager.getLeafId(), oldLeafId);
	assert.deepEqual(runtime.agent.state.messages, messages);
});

test("second navigation cancellation restores SessionManager leaf and live agent context", async () => {
	const { manager, runtime, ctx, selected, oldLeafId } = makeRealPiHarness((call) => call === 2);
	const messages = structuredClone(runtime.agent.state.messages);

	assert.equal(await editAssistantMessage(ctx, selected, "New response"), false);
	assert.equal(manager.getLeafId(), oldLeafId);
	assert.deepEqual(runtime.agent.state.messages, messages);
	assertRuntimeSynchronized(manager, runtime);
});

test("replacement and restoration cancellation keep the real Pi manager and live context synchronized", async () => {
	const { manager, runtime, ctx, selected, toolResultId, getNavigationCalls } = makeToolResultHarness(
		(call) => call === 2 || call === 3,
	);

	assert.equal(await editAssistantMessage(ctx, selected, "New response"), false);
	assert.equal(getNavigationCalls(), 3);
	assert.equal(manager.getLeafId(), toolResultId, "cancelled restoration leaves the last synchronized branch active");
	assertRuntimeSynchronized(manager, runtime);
});

test("failure after replacement navigation restores SessionManager leaf and live agent context", async () => {
	const { manager, runtime, ctx, selected, oldLeafId } = makeRealPiHarness();
	const messages = structuredClone(runtime.agent.state.messages);
	const navigateTree = ctx.navigateTree;
	let calls = 0;
	ctx.navigateTree = async (...args: any[]) => {
		const result = await navigateTree(...args);
		calls += 1;
		if (calls === 2) throw new Error("post-navigation failure");
		return result;
	};

	assert.equal(await editAssistantMessage(ctx, selected, "New response"), false);
	assert.equal(manager.getLeafId(), oldLeafId);
	assert.deepEqual(runtime.agent.state.messages, messages);
	assertRuntimeSynchronized(manager, runtime);
});

test("writable session adapter accepts only the Pi 0.80.9 mutation methods it uses", () => {
	const compatible = {
		branch() {},
		resetLeaf() {},
		appendMessage() { return "message"; },
		appendCustomEntry() { return "custom"; },
		appendCustomMessageEntry() { return "custom-message"; },
	};
	assert.equal(getWritableSessionManagerAdapter(compatible), compatible);
	assert.equal(getWritableSessionManagerAdapter({ ...compatible, branch: undefined }), undefined);
	assert.equal(getWritableSessionManagerAdapter(null), undefined);
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

test("session lifecycle clears hotkey drafts before a replacement session starts", async () => {
	let sessionStartHandler: ((event: unknown, ctx: any) => void) | undefined;
	let commandHandler: ((args: string, ctx: any) => Promise<void>) | undefined;
	let editorFactory: ((tui: unknown, theme: unknown, keybindings: any) => any) | undefined;

	editSessionInPlace({
		registerCommand(_name: string, options: { handler: (args: string, ctx: any) => Promise<void> }) {
			commandHandler = options.handler;
		},
		on(event: string, handler: (event: unknown, ctx: any) => void) {
			if (event === "session_start") sessionStartHandler = handler;
		},
		getCommands: () => [{ name: "edit-turn" }],
	} as any);

	const makeContext = (setEditorText: (text: string) => void) => ({
		mode: "tui",
		hasPendingMessages: () => false,
		isIdle: () => true,
		sessionManager: { getBranch: () => [] },
		ui: {
			getEditorComponent: () => () => ({
				getText: () => "draft",
				setText() {},
				handleInput() {},
				render: () => [],
				invalidate() {},
			}),
			setEditorComponent: (factory: typeof editorFactory) => {
				editorFactory = factory;
			},
			notify() {},
			setEditorText,
		},
	});

	let restored = false;
	sessionStartHandler?.({}, makeContext(() => {
		restored = true;
	}));
	editorFactory?.({}, {}, { matches: () => false }).handleInput("\x1b[69;6u");

	// A replacement session gets a fresh session_start before its command context is used.
	sessionStartHandler?.({}, makeContext(() => {
		restored = true;
	}));
	await commandHandler?.("", makeContext(() => {
		restored = true;
	}));

	assert.equal(restored, false, "draft from the old session must not cross replacement boundaries");
});
