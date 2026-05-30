/**
 * Purpose: Regression coverage for editable-message extraction and external-editor helper behavior.
 * Responsibilities: Verify ordering/filtering, image warnings, command parsing, env resolution, and editor output trimming.
 * Scope: Pure helper and low-level behavior tests only; no interactive TUI integration.
 * Usage: Run via `npm test` after compiling test fixtures to `.test-dist`.
 * Invariants/Assumptions: Tests target the published extension entrypoint shape and current pi helper behavior.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	extractEditableText,
	getEditableMessages,
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
	assert.match(messages[2]?.label ?? "", /^3\. 2026-04-07 12:04 — Latest prompt$/);
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
