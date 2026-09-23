import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import editSessionInPlace from "../extensions/edit-session-in-place.js";

for (const pending of [false, true]) {
	test(`native shortcut preserves expanded draft on ${pending ? "pending queues" : "empty branch"}`, async () => {
		let shortcut: Parameters<ExtensionAPI["registerShortcut"]>[1]["handler"] | undefined;
		let command: Parameters<ExtensionAPI["registerCommand"]>[1]["handler"] | undefined;
		let text = "expanded paste\n".repeat(25);
		const draft = text;
		const sent: unknown[] = [];
		const api: Partial<ExtensionAPI> = {
			registerShortcut(_key, options) { shortcut = options.handler; },
			registerCommand(_name, options) { command = options.handler; },
			on() { return () => {}; },
			getCommands: () => [
				{ name: "edit-turn:1", source: "extension" },
				{ name: "edit-turn:2", source: "extension" },
			] as ReturnType<ExtensionAPI["getCommands"]>,
			sendUserMessage(content, options) { sent.push({ content, options }); },
		};
		editSessionInPlace(api as ExtensionAPI);
		const ctx = {
			mode: "tui",
			hasPendingMessages: () => pending,
			isIdle: () => true,
			sessionManager: { getBranch: () => [] },
			ui: {
				getEditorText: () => text,
				setEditorText(value: string) { text = value; },
				notify() {}, setStatus() {},
			},
		} as unknown as ExtensionCommandContext;
		assert.ok(shortcut);
		assert.ok(command);
		await shortcut(ctx);
		await shortcut(ctx);
		assert.equal(text, "");
		assert.deepEqual(sent, [{content: "/edit-turn:2", options: {expandPromptTemplates: true}}]);
		await command("", ctx);
		assert.equal(text, draft);
	});
}

test("native shortcut does not inject an absent extension command or run outside TUI", async () => {
	let shortcut: Parameters<ExtensionAPI["registerShortcut"]>[1]["handler"] | undefined;
	const api: Partial<ExtensionAPI> = {
		registerShortcut(_key, options) { shortcut = options.handler; },
		registerCommand() {}, on() { return () => {}; },
		getCommands: () => [],
		sendUserMessage() { assert.fail("must not fall through to a model prompt"); },
	};
	editSessionInPlace(api as ExtensionAPI);
	assert.ok(shortcut);
	await shortcut({ mode: "rpc" } as ExtensionContext);
	await shortcut({ mode: "tui" } as ExtensionContext);
});
