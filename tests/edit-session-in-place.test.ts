import assert from "node:assert/strict";

import { extractEditableText, getEditableMessages } from "../extensions/edit-session-in-place.ts";

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
] as any;

const plain = extractEditableText("hello");
assert.deepEqual(plain, { text: "hello", hasImages: false });

const mixed = extractEditableText([
	{ type: "text", text: "hello" },
	{ type: "image", data: "abc", mimeType: "image/png" },
	{ type: "text", text: "world" },
]);
assert.equal(mixed.text, "hello\nworld");
assert.equal(mixed.hasImages, true);

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

console.log("edit-session-in-place tests passed");
