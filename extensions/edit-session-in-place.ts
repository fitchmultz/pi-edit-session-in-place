/**
 * Purpose: Let the user rewind to and re-edit or delete an earlier user message in the current session branch.
 * Responsibilities: Provide a selector UI, a fast clear-all edit UI, and tree navigation that rewinds to the selected point.
 * Scope: Single publishable pi extension plus pure helpers exported for regression tests.
 * Usage: Install as a pi package and invoke with /edit-turn or Ctrl+Shift+E.
 * Invariants/Assumptions: Operates on the current branch only; later branch history remains in /tree; empty submit means delete.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	CustomEditor,
	DynamicBorder,
	keyHint,
	rawKeyHint,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type KeybindingsManager,
	type SessionEntry,
	type Theme,
} from "@mariozechner/pi-coding-agent";
import {
	Container,
	Editor,
	Key,
	SelectList,
	Spacer,
	Text,
	matchesKey,
	type EditorTheme,
	type Focusable,
	type TUI,
} from "@mariozechner/pi-tui";

const HOTKEY = Key.ctrlShift("e");
const HOTKEY_LABEL = "Ctrl+Shift+E";
const CLEAR_ALL_KEY = "ctrl+x";
const COMMAND_NAME = "edit-turn";
const COMMAND_TEXT = `/${COMMAND_NAME}`;
const SELECT_TITLE = "Pick a previous user message to edit";
const EDIT_TITLE = "Edit previous user message";
const PREVIEW_MAX_LENGTH = 90;
const SELECTOR_MAX_VISIBLE = 12;
const SELECTOR_PAGE_STEP = SELECTOR_MAX_VISIBLE - 1;
const EXTERNAL_EDITOR_TMP_PREFIX = "pi-reedit-message-";
const EXTERNAL_EDITOR_FILE_NAME = "message.md";

type TextContentBlock = {
	type?: string;
	text?: string;
};

type ImageContentBlock = {
	type?: string;
};

export type EditableUserMessage = {
	entryId: string;
	text: string;
	hasImages: boolean;
	label: string;
};

export type ExternalEditorCommand = {
	executable: string;
	args: string[];
};

let draftBeforeHotkey: string | undefined;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
const collapseWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();

const truncate = (text: string, maxLength: number) =>
	text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;

const formatTimestamp = (timestamp: string) => timestamp.slice(0, 16).replace("T", " ");

const createEditorTheme = (theme: Theme): EditorTheme => ({
	borderColor: (text) => theme.fg("accent", text),
	selectList: {
		selectedPrefix: (text) => theme.fg("accent", text),
		selectedText: (text) => theme.fg("accent", text),
		description: (text) => theme.fg("muted", text),
		scrollInfo: (text) => theme.fg("dim", text),
		noMatch: (text) => theme.fg("warning", text),
	},
});

export const resolveExternalEditorCommand = (env: NodeJS.ProcessEnv) => {
	const visual = env.VISUAL?.trim();
	if (visual) {
		return visual;
	}

	const editor = env.EDITOR?.trim();
	return editor || undefined;
};

export const parseExternalEditorCommand = (command: string): ExternalEditorCommand => {
	const parts: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let tokenStarted = false;

	const pushCurrent = () => {
		if (!tokenStarted) {
			return;
		}

		parts.push(current);
		current = "";
		tokenStarted = false;
	};

	for (let index = 0; index < command.length; index += 1) {
		const character = command[index];
		if (!character) {
			continue;
		}

		if (quote === "'") {
			if (character === "'") {
				quote = undefined;
			} else {
				current += character;
			}
			tokenStarted = true;
			continue;
		}

		if (quote === '"') {
			if (character === '"') {
				quote = undefined;
				continue;
			}

			if (character === "\\") {
				const next = command[index + 1];
				if (next && ['"', "\\", "$", "`"].includes(next)) {
					current += next;
					index += 1;
				} else {
					current += character;
				}
				tokenStarted = true;
				continue;
			}

			current += character;
			tokenStarted = true;
			continue;
		}

		if (/\s/.test(character)) {
			pushCurrent();
			continue;
		}

		if (character === "'" || character === '"') {
			quote = character;
			tokenStarted = true;
			continue;
		}

		if (character === "\\") {
			const next = command[index + 1];
			if (next && /[\s'"\\]/.test(next)) {
				current += next;
				index += 1;
			} else {
				current += character;
			}
			tokenStarted = true;
			continue;
		}

		current += character;
		tokenStarted = true;
	}

	if (quote) {
		throw new Error("Unterminated quote in $VISUAL/$EDITOR.");
	}

	pushCurrent();

	const [executable, ...args] = parts;
	if (!executable) {
		throw new Error("External editor command is empty.");
	}

	return { executable, args };
};

export const trimSingleTrailingNewline = (text: string) => text.replace(/\r?\n$/, "");

export const extractEditableText = (content: unknown): { text: string | undefined; hasImages: boolean } => {
	if (typeof content === "string") {
		const text = content.trim();
		return { text: text.length > 0 ? content : undefined, hasImages: false };
	}

	if (!Array.isArray(content)) {
		return { text: undefined, hasImages: false };
	}

	const textParts: string[] = [];
	let hasImages = false;

	for (const block of content) {
		if (!block || typeof block !== "object") {
			continue;
		}

		const textBlock = block as TextContentBlock;
		if (textBlock.type === "text" && typeof textBlock.text === "string") {
			textParts.push(textBlock.text);
			continue;
		}

		const imageBlock = block as ImageContentBlock;
		if (imageBlock.type === "image") {
			hasImages = true;
		}
	}

	const joined = textParts.join("\n");
	return {
		text: joined.trim().length > 0 ? joined : undefined,
		hasImages,
	};
};

export const getEditableMessages = (branch: SessionEntry[]): EditableUserMessage[] => {
	const editable: EditableUserMessage[] = [];
	const userEntries = branch.filter(
		(entry): entry is SessionEntry & { type: "message"; message: { role: "user"; content: unknown } } =>
			entry.type === "message" && entry.message.role === "user",
	);

	for (const entry of userEntries) {
		const { text, hasImages } = extractEditableText(entry.message.content);
		if (!text) {
			continue;
		}

		const previewSource = collapseWhitespace(text.split("\n").find((line) => line.trim().length > 0) ?? text);
		const preview = truncate(previewSource, PREVIEW_MAX_LENGTH);
		const suffix = hasImages ? " [drops images]" : "";
		const index = editable.length + 1;
		editable.push({
			entryId: entry.id,
			text,
			hasImages,
			label: `${index}. ${formatTimestamp(entry.timestamp)} — ${preview}${suffix}`,
		});
	}

	return editable;
};

class EditableMessageSelector extends Container {
	private readonly tui: TUI;
	private readonly keybindings: KeybindingsManager;
	private readonly messages: EditableUserMessage[];
	private readonly selectList: SelectList;
	private readonly onSelect: (message: EditableUserMessage) => void;
	private readonly onCancel: () => void;
	private selectedIndex: number;

	constructor(
		tui: TUI,
		theme: Theme,
		keybindings: KeybindingsManager,
		title: string,
		messages: EditableUserMessage[],
		onSelect: (message: EditableUserMessage) => void,
		onCancel: () => void,
	) {
		super();
		this.tui = tui;
		this.keybindings = keybindings;
		this.messages = messages;
		this.onSelect = onSelect;
		this.onCancel = onCancel;
		this.selectedIndex = Math.max(0, messages.length - 1);

		this.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", title), 1, 0));
		this.addChild(new Spacer(1));

		this.selectList = new SelectList(
			messages.map((message) => ({ value: message.entryId, label: message.label })),
			SELECTOR_MAX_VISIBLE,
			createEditorTheme(theme).selectList,
			{ minPrimaryColumnWidth: 56, maxPrimaryColumnWidth: 120 },
		);
		this.selectList.setSelectedIndex(this.selectedIndex);
		this.addChild(this.selectList);
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				[
					rawKeyHint("↑", "older"),
					rawKeyHint("↓", "newer"),
					keyHint("tui.select.pageUp", "jump up"),
					keyHint("tui.select.pageDown", "jump down"),
					keyHint("tui.select.confirm", "edit"),
					keyHint("tui.select.cancel", "cancel"),
				].join("  "),
				1,
				0,
			),
		);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
	}

	private setSelectedIndex(index: number) {
		this.selectedIndex = clamp(index, 0, this.messages.length - 1);
		this.selectList.setSelectedIndex(this.selectedIndex);
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "tui.select.up")) {
			this.setSelectedIndex(this.selectedIndex - 1);
			return;
		}

		if (this.keybindings.matches(data, "tui.select.down")) {
			this.setSelectedIndex(this.selectedIndex + 1);
			return;
		}

		if (this.keybindings.matches(data, "tui.select.pageUp")) {
			this.setSelectedIndex(this.selectedIndex - SELECTOR_PAGE_STEP);
			return;
		}

		if (this.keybindings.matches(data, "tui.select.pageDown")) {
			this.setSelectedIndex(this.selectedIndex + SELECTOR_PAGE_STEP);
			return;
		}

		if (this.keybindings.matches(data, "tui.select.confirm")) {
			const selected = this.messages[this.selectedIndex];
			if (selected) {
				this.onSelect(selected);
			}
			return;
		}

		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.onCancel();
		}
	}
}

class ReeditMessageEditor extends Container implements Focusable {
	private readonly editor: Editor;
	private readonly tui: TUI;
	private readonly keybindings: KeybindingsManager;
	private readonly onCancel: () => void;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.editor.focused = value;
	}

	constructor(
		tui: TUI,
		theme: Theme,
		keybindings: KeybindingsManager,
		title: string,
		prefill: string,
		onSubmit: (value: string) => void,
		onCancel: () => void,
	) {
		super();
		this.tui = tui;
		this.keybindings = keybindings;
		this.onCancel = onCancel;

		this.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", title), 1, 0));
		this.addChild(new Spacer(1));

		this.editor = new Editor(tui, createEditorTheme(theme));
		this.editor.setText(prefill);
		this.editor.onSubmit = (value) => onSubmit(value);
		this.addChild(this.editor);
		this.addChild(new Spacer(1));

		const hasExternalEditor = Boolean(resolveExternalEditorCommand(process.env));
		const hint = [
			keyHint("tui.select.confirm", "submit"),
			keyHint("tui.input.newLine", "newline"),
			rawKeyHint("ctrl+x", "clear all"),
			rawKeyHint("empty+enter", "delete"),
			keyHint("tui.select.cancel", "cancel"),
			...(hasExternalEditor ? [keyHint("app.editor.external", "external editor")] : []),
		].join("  ");
		this.addChild(new Text(hint, 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
	}

	handleInput(data: string): void {
		if (matchesKey(data, CLEAR_ALL_KEY)) {
			this.editor.setText("");
			this.tui.requestRender();
			return;
		}

		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.onCancel();
			return;
		}

		if (this.keybindings.matches(data, "app.editor.external")) {
			this.openExternalEditor();
			return;
		}

		this.editor.handleInput(data);
	}

	private openExternalEditor() {
		const editorCommand = resolveExternalEditorCommand(process.env);
		if (!editorCommand) {
			return;
		}

		const currentText = this.editor.getText();
		let parsedCommand: ExternalEditorCommand;
		try {
			parsedCommand = parseExternalEditorCommand(editorCommand);
		} catch {
			return;
		}

		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), EXTERNAL_EDITOR_TMP_PREFIX));
		const tempFile = path.join(tempDir, EXTERNAL_EDITOR_FILE_NAME);
		let nextText: string | undefined;

		try {
			fs.writeFileSync(tempFile, currentText, { encoding: "utf-8", flag: "wx", mode: 0o600 });
			this.tui.stop();

			const result = spawnSync(parsedCommand.executable, [...parsedCommand.args, tempFile], {
				stdio: "inherit",
				shell: process.platform === "win32",
			});

			if (result.status === 0 && !result.error) {
				nextText = trimSingleTrailingNewline(fs.readFileSync(tempFile, "utf-8"));
			}
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
			this.tui.start();
			this.tui.requestRender(true);
		}

		if (nextText !== undefined) {
			this.editor.setText(nextText);
			this.tui.requestRender();
		}
	}
}

const selectEditableMessage = async (ctx: ExtensionCommandContext, messages: EditableUserMessage[]) =>
	ctx.ui.custom<EditableUserMessage | undefined>((tui, theme, keybindings, done) =>
		new EditableMessageSelector(tui, theme, keybindings, SELECT_TITLE, messages, (message) => done(message), () => done(undefined)),
	);

const editTextInCustomEditor = async (ctx: ExtensionCommandContext, prefill: string) =>
	ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) =>
		new ReeditMessageEditor(tui, theme, keybindings, EDIT_TITLE, prefill, (value) => done(value), () => done(undefined)),
	);

const restoreDraftIfNeeded = (ctx: ExtensionCommandContext) => {
	if (draftBeforeHotkey === undefined) {
		return;
	}

	ctx.ui.setEditorText(draftBeforeHotkey);
	draftBeforeHotkey = undefined;
};

const clearSavedDraft = () => {
	draftBeforeHotkey = undefined;
};

const handleEditTurn = async (ctx: ExtensionCommandContext) => {
	if (!ctx.hasUI) {
		clearSavedDraft();
		return;
	}

	if (ctx.hasPendingMessages()) {
		ctx.ui.notify("Queued messages are pending. Press Escape first, then try again.", "warning");
		restoreDraftIfNeeded(ctx);
		return;
	}

	if (!ctx.isIdle()) {
		ctx.abort();
		await ctx.waitForIdle();
	}

	const editableMessages = getEditableMessages(ctx.sessionManager.getBranch());
	if (editableMessages.length === 0) {
		ctx.ui.notify("No editable text user messages found on the current branch.", "warning");
		restoreDraftIfNeeded(ctx);
		return;
	}

	const selected = await selectEditableMessage(ctx, editableMessages);
	if (!selected) {
		restoreDraftIfNeeded(ctx);
		return;
	}

	if (selected.hasImages) {
		const keepGoing = await ctx.ui.confirm(
			"Drop images?",
			"That message contains images. Editing or deleting it here will keep only the text and drop the images. Continue?",
		);
		if (!keepGoing) {
			restoreDraftIfNeeded(ctx);
			return;
		}
	}

	const editedText = await editTextInCustomEditor(ctx, selected.text);
	if (editedText === undefined) {
		restoreDraftIfNeeded(ctx);
		return;
	}

	const isDelete = editedText.trim().length === 0;
	const result = await ctx.navigateTree(selected.entryId, { summarize: false });
	if (result.cancelled) {
		restoreDraftIfNeeded(ctx);
		return;
	}

	clearSavedDraft();
	ctx.ui.setEditorText(isDelete ? "" : editedText);
	ctx.ui.notify(
		isDelete
			? "Message deleted. Type a new prompt to continue from that point."
			: "Edited message loaded. Press Enter to continue from that point.",
		"info",
	);
};

class EditSessionInPlaceEditor extends CustomEditor {
	handleInput(data: string): void {
		if (matchesKey(data, HOTKEY)) {
			draftBeforeHotkey = this.getText();
			this.setText(COMMAND_TEXT);
			super.handleInput("\r");
			return;
		}

		super.handleInput(data);
	}
}

export default function editSessionInPlace(pi: ExtensionAPI) {
	pi.registerCommand(COMMAND_NAME, {
		description: `Select and re-edit a previous user message on the current branch (${HOTKEY_LABEL})`,
		handler: async (_args, ctx) => {
			await handleEditTurn(ctx);
		},
	});

	// pi 0.65.2 shortcut handlers receive ExtensionContext, which cannot run slash commands
	// or navigate the session tree. Keep the custom editor hotkey path for execution, and
	// register the shortcut here so it appears in /hotkeys and other shortcut diagnostics.
	pi.registerShortcut(HOTKEY, {
		description: `Edit a previous user message (${HOTKEY_LABEL})`,
		handler: (ctx) => {
			if (!ctx.hasUI) {
				return;
			}

			ctx.ui.notify(`Press ${HOTKEY_LABEL} in the main editor to edit a previous message.`, "info");
		},
	});

	pi.on("session_start", async () => {
		clearSavedDraft();
	});

	pi.on("session_shutdown", async () => {
		clearSavedDraft();
	});

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new EditSessionInPlaceEditor(tui, theme, keybindings));
	});
}
