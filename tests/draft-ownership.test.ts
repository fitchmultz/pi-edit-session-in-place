import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import editSessionInPlace from "../extensions/edit-session-in-place.ts";

// Focused ownership tests. Native TUI/navigation/abort qualification is separate;
// these doubles deliberately expose each awaited command boundary.
const harness = () => {
	let text = "expanded draft\n".repeat(25);
	const original = text;
	let shortcut: Parameters<ExtensionAPI["registerShortcut"]>[1]["handler"];
	let command: Parameters<ExtensionAPI["registerCommand"]>[1]["handler"];
	let sent = 0;
	const tasks: Promise<void>[] = [];
	const events = new Map<string, () => void>();
	const ctx = {
		mode: "tui", hasUI: true,
		hasPendingMessages: () => false,
		isIdle: () => true,
		abort() {}, waitForIdle: async () => {},
		sessionManager: { getLeafId: () => "user", getBranch: () => [{
			type: "message", id: "user", parentId: null, timestamp: "2026-01-01T00:00:00Z",
			message: { role: "user", content: "prior prompt" },
		}] },
		ui: {
			getEditorText: () => text,
			setEditorText(value: string) { text = value; },
			setStatus() {}, notify() {},
			custom: async (): Promise<unknown> => undefined,
		},
	} as unknown as ExtensionCommandContext;
	editSessionInPlace({
		registerShortcut(_key: string, options: Parameters<ExtensionAPI["registerShortcut"]>[1]) { shortcut = options.handler; },
		registerCommand(_name: string, options: Parameters<ExtensionAPI["registerCommand"]>[1]) { command = options.handler; },
		on(event: string, handler: () => void) { events.set(event, handler); },
		getCommands: () => [{name: "edit-turn", source: "extension"}],
		sendUserMessage() {
			sent++;
			tasks.push(command("", ctx));
		},
		appendEntry() {},
	} as unknown as ExtensionAPI);
	return {
		ctx, original, tasks,
		text: () => text, sent: () => sent,
		press: () => shortcut(ctx),
		command: () => command("", ctx),
		replace: () => events.get("session_start")!(),
	};
};

for (const failure of ["waitForIdle", "selection", "navigation"] as const) {
	test(`${failure} rejection restores draft before command ends and allows retry`, async () => {
		const h = harness();
		const error = new Error("controlled callback failure");
		if (failure === "waitForIdle") {
			h.ctx.isIdle = () => false;
			h.ctx.waitForIdle = async () => { throw error; };
		} else if (failure === "selection") {
			h.ctx.ui.custom = async () => { throw error; };
		} else {
			let calls = 0;
			h.ctx.ui.custom = (async () => ++calls === 1
				? {entryId: "user", role: "user", text: "prior prompt"} : "edited prompt") as any;
			h.ctx.navigateTree = async () => { throw error; };
		}
		h.press();
		assert.equal(h.text(), "");
		await assert.rejects(h.tasks[0]!, error);
		assert.equal(h.text(), h.original);
		h.ctx.isIdle = () => true;
		h.ctx.ui.custom = async () => undefined as any;
		h.press();
		await h.tasks[1];
		assert.equal(h.text(), h.original);
		assert.equal(h.sent(), 2);
	});
}

test("repeated hotkey and direct command cannot take a running command's draft", async () => {
	const h = harness();
	let release!: () => void;
	h.ctx.isIdle = () => false;
	h.ctx.waitForIdle = () => new Promise<void>(resolve => { release = resolve; });
	h.press();
	h.press();
	await h.command();
	assert.equal(h.sent(), 1);
	assert.equal(h.text(), "");
	release();
	await h.tasks[0];
	assert.equal(h.text(), h.original);
	h.ctx.isIdle = () => true;
	h.press();
	await h.tasks[1];
	assert.equal(h.text(), h.original);
});

for (const boundary of ["waitForIdle", "selection", "confirmation", "editor", "navigation"] as const) {
	test(`replacement at ${boundary} ignores a late callback and never touches the outgoing UI`, async () => {
		const h = harness();
		let release!: () => void;
		const pending = new Promise<void>(resolve => { release = resolve; });
		const selected = { entryId: "user", role: "user", text: "prior prompt", hasImages: boundary === "confirmation" };
		if (boundary === "waitForIdle") {
			h.ctx.isIdle = () => false;
			h.ctx.waitForIdle = () => pending;
		} else {
			let dialogs = 0;
			h.ctx.ui.custom = (async () => {
				if (++dialogs === 1) {
					if (boundary === "selection") await pending;
					return selected;
				}
				if (boundary === "editor") await pending;
				return "edited text";
			}) as ExtensionCommandContext["ui"]["custom"];
			h.ctx.ui.confirm = async () => { await pending; return true; };
			h.ctx.navigateTree = async () => { await pending; return { cancelled: false }; };
		}
		h.press();
		await new Promise(resolve => setImmediate(resolve));
		h.replace();
		h.ctx.ui.setEditorText("Incoming draft");
		h.ctx.sessionManager.getBranch = () => { assert.fail("Outgoing session manager is invalid after replacement"); };
		for (const key of ["getEditorText", "setEditorText", "setStatus", "notify"] as const) {
			h.ctx.ui[key] = (() => { assert.fail("Outgoing UI is invalid after replacement"); }) as never;
		}
		release();
		await h.tasks[0];
		assert.equal(h.text(), "Incoming draft");
	});
}
