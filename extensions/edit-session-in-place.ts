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
	type AppKeybinding,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type KeybindingsManager,
	SessionManager,
	type SessionEntry,
	VERSION,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	Editor,
	Key,
	SelectList,
	Spacer,
	Text,
	isFocusable,
	matchesKey,
	type EditorComponent,
	type EditorTheme,
	type Focusable,
	type TUI,
} from "@earendil-works/pi-tui";

const HOTKEY = Key.ctrlShift("e");
const HOTKEY_LABEL = "Ctrl+Shift+E";
const CLEAR_ALL_KEY = "ctrl+x";
const TOGGLE_ASSISTANT_KEY = "ctrl+a";
const COMMAND_NAME = "edit-turn";
const COMMAND_TEXT = `/${COMMAND_NAME}`;
const SELECT_TITLE = "Pick a previous user message to edit";
const EDIT_TITLE = "Edit previous message";
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

export type EditableMessage = {
	entryId: string;
	parentId: string | null;
	role: "user" | "assistant";
	text: string;
	hasImages: boolean;
	label: string;
};

export type EditableUserMessage = EditableMessage;

export type ExternalEditorCommand = {
	executable: string;
	args: string[];
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
const collapseWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();

const truncate = (text: string, maxLength: number) =>
	text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;

export const formatTimestamp = (timestamp: string) => {
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) {
		// ponytail: malformed/unknown timestamps fall back to the raw slice rather than rendering NaN fields
		return timestamp.slice(0, 16).replace("T", " ");
	}

	const pad = (value: number) => value.toString().padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

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

export const getExpandedEditorText = (editor: Pick<EditorComponent, "getText" | "getExpandedText">) =>
	editor.getExpandedText?.() ?? editor.getText();

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

export const getEditableMessages = (branch: SessionEntry[], options: { includeAssistant?: boolean } = {}): EditableMessage[] => {
	const editable: EditableMessage[] = [];

	for (const entry of branch) {
		if (entry.type !== "message" || (entry.message.role !== "user" && entry.message.role !== "assistant")) {
			continue;
		}

		if (entry.message.role === "assistant" && !options.includeAssistant) {
			continue;
		}

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
			parentId: entry.parentId,
			role: entry.message.role,
			text,
			hasImages,
			label: `${index}. ${formatTimestamp(entry.timestamp)} — ${entry.message.role === "assistant" ? "assistant — " : ""}${preview}${suffix}`,
		});
	}

	return editable;
};

class EditableMessageSelector extends Container {
	private readonly tui: TUI;
	private readonly keybindings: KeybindingsManager;
	private readonly userMessages: EditableMessage[];
	private readonly allMessages: EditableMessage[];
	private readonly selectTheme: ReturnType<typeof createEditorTheme>["selectList"];
	private selectList: SelectList;
	private readonly onSelect: (message: EditableMessage) => void;
	private readonly onCancel: () => void;
	private messages: EditableMessage[];
	private selectedIndex: number;
	private includeAssistant = false;

	constructor(
		tui: TUI,
		theme: Theme,
		keybindings: KeybindingsManager,
		title: string,
		userMessages: EditableMessage[],
		allMessages: EditableMessage[],
		onSelect: (message: EditableMessage) => void,
		onCancel: () => void,
	) {
		super();
		this.tui = tui;
		this.keybindings = keybindings;
		this.userMessages = userMessages;
		this.allMessages = allMessages;
		this.messages = userMessages;
		this.selectTheme = createEditorTheme(theme).selectList;
		this.onSelect = onSelect;
		this.onCancel = onCancel;
		this.selectedIndex = Math.max(0, userMessages.length - 1);

		this.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", title), 1, 0));
		this.addChild(new Spacer(1));

		this.selectList = this.createSelectList();
		this.addChild(this.selectList);
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				[
					rawKeyHint("↑", "older"),
					rawKeyHint("↓", "newer"),
					keyHint("tui.select.pageUp", "jump up"),
					keyHint("tui.select.pageDown", "jump down"),
					rawKeyHint("ctrl+a", "show assistants"),
					keyHint("tui.select.confirm", "edit"),
					keyHint("tui.select.cancel", "cancel"),
				].join("  "),
				1,
				0,
			),
		);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
	}

	private createSelectList() {
		const selectList = new SelectList(
			this.messages.map((message) => ({ value: message.entryId, label: message.label })),
			SELECTOR_MAX_VISIBLE,
			this.selectTheme,
			{ minPrimaryColumnWidth: 56, maxPrimaryColumnWidth: 120 },
		);
		selectList.setSelectedIndex(this.selectedIndex);
		return selectList;
	}

	private setSelectedIndex(index: number) {
		this.selectedIndex = clamp(index, 0, this.messages.length - 1);
		this.selectList.setSelectedIndex(this.selectedIndex);
		this.tui.requestRender();
	}

	private toggleAssistantMessages() {
		const selectedEntryId = this.messages[this.selectedIndex]?.entryId;
		this.includeAssistant = !this.includeAssistant;
		this.messages = this.includeAssistant ? this.allMessages : this.userMessages;
		const keptIndex = selectedEntryId ? this.messages.findIndex((message) => message.entryId === selectedEntryId) : -1;
		this.selectedIndex = keptIndex >= 0 ? keptIndex : Math.max(0, this.messages.length - 1);

		const previousSelectList = this.selectList;
		this.selectList = this.createSelectList();
		const childIndex = this.children.indexOf(previousSelectList);
		if (childIndex >= 0) {
			this.children[childIndex] = this.selectList;
		}
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

		if (matchesKey(data, TOGGLE_ASSISTANT_KEY)) {
			this.toggleAssistantMessages();
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
	private readonly onError: (message: string) => void;
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
		onError: (message: string) => void,
	) {
		super();
		this.tui = tui;
		this.keybindings = keybindings;
		this.onCancel = onCancel;
		this.onError = onError;

		this.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
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
		this.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
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

		const currentText = getExpandedEditorText(this.editor);
		let parsedCommand: ExternalEditorCommand;
		try {
			parsedCommand = parseExternalEditorCommand(editorCommand);
		} catch (error) {
			this.onError(error instanceof Error ? error.message : "Failed to parse $VISUAL/$EDITOR.");
			return;
		}

		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), EXTERNAL_EDITOR_TMP_PREFIX));
		const tempFile = path.join(tempDir, EXTERNAL_EDITOR_FILE_NAME);
		let nextText: string | undefined;
		let errorMessage: string | undefined;

		try {
			fs.writeFileSync(tempFile, currentText, { encoding: "utf-8", flag: "wx", mode: 0o600 });
			this.tui.stop();

			const result = spawnSync(parsedCommand.executable, [...parsedCommand.args, tempFile], {
				stdio: "inherit",
				shell: process.platform === "win32",
			});

			if (result.error) {
				errorMessage = `External editor failed: ${result.error.message}`;
			} else if (result.status !== 0) {
				errorMessage = `External editor exited with status ${result.status ?? "unknown"}.`;
			} else {
				nextText = trimSingleTrailingNewline(fs.readFileSync(tempFile, "utf-8"));
			}
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
			this.tui.start();
			this.tui.requestRender(true);
		}

		if (errorMessage) {
			this.onError(errorMessage);
			return;
		}

		if (nextText !== undefined) {
			this.editor.setText(nextText);
			this.tui.requestRender();
		}
	}
}

const selectEditableMessage = async (ctx: ExtensionCommandContext, userMessages: EditableMessage[], allMessages: EditableMessage[]) =>
	ctx.ui.custom<EditableMessage | undefined>((tui, theme, keybindings, done) =>
		new EditableMessageSelector(
			tui,
			theme,
			keybindings,
			SELECT_TITLE,
			userMessages,
			allMessages,
			(message) => done(message),
			() => done(undefined),
		),
	);

const editTextInCustomEditor = async (ctx: ExtensionCommandContext, prefill: string) =>
	ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) =>
		new ReeditMessageEditor(
			tui,
			theme,
			keybindings,
			EDIT_TITLE,
			prefill,
			(value) => done(value),
			() => done(undefined),
			(message) => ctx.ui.notify(message, "warning"),
		),
	);

type DraftState = { value?: string };

const EDITOR_RENDER_STATUS_KEY = "edit-session-in-place:editor-render";

const setEditorTextAndRender = (ctx: ExtensionCommandContext, text: string) => {
	ctx.ui.setEditorText(text);
	// Pi 0.84 setEditorText mutates the editor without scheduling a render.
	ctx.ui.setStatus(EDITOR_RENDER_STATUS_KEY, undefined);
};

const restoreDraftIfNeeded = (ctx: ExtensionCommandContext, draft: DraftState) => {
	if (draft.value === undefined) return;
	setEditorTextAndRender(ctx, draft.value);
	draft.value = undefined;
};

type WritablePi084SessionManager = Pick<
	SessionManager,
	"branch" | "resetLeaf" | "appendMessage" | "appendCustomEntry" | "appendCustomMessageEntry"
>;

const PI_084_WRITABLE_SESSION_METHODS: ReadonlyArray<keyof WritablePi084SessionManager> = [
	"branch",
	"resetLeaf",
	"appendMessage",
	"appendCustomEntry",
	"appendCustomMessageEntry",
];

export const isPi084OrLater = (version: string) => {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) return false;
	const major = Number(match[1]);
	const minor = Number(match[2]);
	return major > 0 || (major === 0 && minor >= 84);
};

/** Fail closed unless Pi supplied the 0.84+ private mutation surface validated by this package. */
export const getWritablePi084SessionManager = (
	value: unknown,
	version = VERSION,
): WritablePi084SessionManager | undefined => {
	if (!isPi084OrLater(version) || !(value instanceof SessionManager)) return undefined;
	return PI_084_WRITABLE_SESSION_METHODS.every((method) => typeof value[method] === "function") ? value : undefined;
};

export const editAssistantMessage = async (ctx: ExtensionCommandContext, selected: EditableMessage, editedText: string) => {
	if (!selected.parentId) {
		ctx.ui.notify("Cannot edit an assistant message with no parent entry.", "warning");
		return false;
	}

	const sessionManager = getWritablePi084SessionManager(ctx.sessionManager);
	if (!sessionManager) {
		ctx.ui.notify("Assistant editing requires Pi's validated 0.84+ SessionManager runtime.", "warning");
		return false;
	}

	const original = ctx.sessionManager.getEntry(selected.entryId);
	const parent = ctx.sessionManager.getEntry(selected.parentId);
	if (original?.type !== "message" || original.message.role !== "assistant" || !parent) {
		ctx.ui.notify("Could not find the selected assistant message and its preceding branch.", "warning");
		return false;
	}

	const oldLeafId = ctx.sessionManager.getLeafId();
	const oldLeaf = oldLeafId ? ctx.sessionManager.getEntry(oldLeafId) : undefined;
	if (!oldLeafId || !oldLeaf || (oldLeaf.type === "message" && oldLeaf.message.role === "user") || oldLeaf.type === "custom_message") {
		ctx.ui.notify("Cannot safely restore the current session position.", "warning");
		return false;
	}

	const editorTextBeforeNavigation = ctx.ui.getEditorText();
	const restoreEditor = () => setEditorTextAndRender(ctx, editorTextBeforeNavigation);
	const restore = async () => {
		try {
			return !(await ctx.navigateTree(oldLeafId, { summarize: false })).cancelled;
		} catch {
			return false;
		}
	};
	let synchronizedLeafId: string | null | undefined;
	let replacementNavigationStarted = false;

	try {
		const parentResult = await ctx.navigateTree(selected.parentId, { summarize: false });
		if (parentResult.cancelled) {
			restoreEditor();
			return false;
		}

		synchronizedLeafId = ctx.sessionManager.getLeafId();
		// Pi navigates before editable user/custom messages. Replay only that dropped parent;
		// tool results, compactions, metadata, and other non-user parents stay on the branch.
		if (parent.type === "message" && parent.message.role === "user") {
			sessionManager.appendMessage(parent.message);
		} else if (parent.type === "custom_message") {
			sessionManager.appendCustomMessageEntry(parent.customType, parent.content, parent.display, parent.details);
		}

		const targetId =
			editedText.trim().length === 0
				? sessionManager.appendCustomEntry("edit-session-in-place:assistant-delete", { deletedEntryId: selected.entryId })
				: sessionManager.appendMessage({
						role: "assistant",
						content: [{ type: "text", text: editedText }],
						api: original.message.api,
						provider: original.message.provider,
						model: original.message.model,
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
						stopReason: original.message.stopReason,
						timestamp: original.message.timestamp,
					});

		// Return the manager to the leaf represented by the live agent before public
		// navigation. If replacement or restoration is cancelled, both stay aligned.
		if (synchronizedLeafId) sessionManager.branch(synchronizedLeafId);
		else sessionManager.resetLeaf();
		replacementNavigationStarted = true;
		const result = await ctx.navigateTree(targetId, { summarize: false });
		if (!result.cancelled) {
			restoreEditor();
			return true;
		}
	} catch {
		if (!replacementNavigationStarted && synchronizedLeafId !== undefined) {
			if (synchronizedLeafId) sessionManager.branch(synchronizedLeafId);
			else sessionManager.resetLeaf();
		}
		if (await restore()) {
			ctx.ui.notify("Assistant editing failed; the prior runtime state was restored.", "warning");
			restoreEditor();
			return false;
		}
		ctx.ui.notify("Assistant editing failed; Pi kept the last synchronized session position.", "warning");
		restoreEditor();
		return false;
	}

	if (!(await restore())) {
		ctx.ui.notify("Assistant editing was cancelled; Pi kept the last synchronized session position.", "warning");
	}
	restoreEditor();
	return false;
};

const handleEditTurn = async (ctx: ExtensionCommandContext, draft: DraftState) => {
	if (ctx.mode !== "tui") {
		if (ctx.hasUI) {
			ctx.ui.notify("/edit-turn requires interactive TUI mode.", "warning");
		}
		draft.value = undefined;
		return;
	}

	if (ctx.hasPendingMessages()) {
		ctx.ui.notify("Queued messages are pending. Press Escape first, then try again.", "warning");
		restoreDraftIfNeeded(ctx, draft);
		return;
	}

	if (!ctx.isIdle()) {
		ctx.abort();
		await ctx.waitForIdle();
	}

	const userMessages = getEditableMessages(ctx.sessionManager.getBranch());
	const allMessages = getEditableMessages(ctx.sessionManager.getBranch(), { includeAssistant: true });
	if (userMessages.length === 0) {
		ctx.ui.notify("No editable text user messages found on the current branch.", "warning");
		restoreDraftIfNeeded(ctx, draft);
		return;
	}

	const selected = await selectEditableMessage(ctx, userMessages, allMessages);
	if (!selected) {
		restoreDraftIfNeeded(ctx, draft);
		return;
	}

	if (selected.hasImages) {
		const keepGoing = await ctx.ui.confirm(
			"Drop images?",
			"That message contains images. Editing or deleting it here will keep only the text and drop the images. Continue?",
		);
		if (!keepGoing) {
			restoreDraftIfNeeded(ctx, draft);
			return;
		}
	}

	const editedText = await editTextInCustomEditor(ctx, selected.text);
	if (editedText === undefined) {
		restoreDraftIfNeeded(ctx, draft);
		return;
	}

	const isDelete = editedText.trim().length === 0;
	if (selected.role === "assistant") {
		const ok = await editAssistantMessage(ctx, selected, editedText);
		if (!ok) {
			restoreDraftIfNeeded(ctx, draft);
			return;
		}

		restoreDraftIfNeeded(ctx, draft);
		ctx.ui.notify(isDelete ? "Assistant message deleted." : "Assistant message edited.", "info");
		return;
	}

	const result = await ctx.navigateTree(selected.entryId, { summarize: false });
	if (result.cancelled) {
		restoreDraftIfNeeded(ctx, draft);
		return;
	}

	draft.value = undefined;
	ctx.ui.setEditorText(isDelete ? "" : editedText);
	ctx.ui.notify(
		isDelete
			? "Message deleted. Type a new prompt to continue from that point."
			: "Edited message loaded. Press Enter to continue from that point.",
		"info",
	);
};

export const getEditTurnCommandText = (commands: Array<{ name: string }>) => {
	const candidates = commands
		.map((command) => command.name)
		.filter((name) => name === COMMAND_NAME || name.startsWith(`${COMMAND_NAME}:`));
	return `/${candidates.at(-1) ?? COMMAND_NAME}`;
};

type CustomEditorHooks = {
	actionHandlers: Map<AppKeybinding, () => void>;
	onEscape?: () => void;
	onCtrlD?: () => void;
	onPasteImage?: () => void;
	onExtensionShortcut?: (data: string) => boolean | undefined;
};

const getCustomEditorHooks = (editor: EditorComponent): (EditorComponent & CustomEditorHooks) | undefined => {
	const candidate = editor as Partial<CustomEditorHooks>;
	return candidate.actionHandlers instanceof Map ? (editor as EditorComponent & CustomEditorHooks) : undefined;
};

class EditSessionInPlaceEditor implements EditorComponent, Focusable {
	private readonly customBase: (EditorComponent & CustomEditorHooks) | undefined;

	constructor(
		private readonly base: EditorComponent,
		private readonly getCommandText: () => string,
		private readonly saveDraft: (draft: string) => void,
	) {
		this.customBase = getCustomEditorHooks(base);
	}

	get actionHandlers(): Map<AppKeybinding, () => void> | undefined {
		return this.customBase?.actionHandlers;
	}

	get focused(): boolean {
		return isFocusable(this.base) ? this.base.focused : false;
	}

	set focused(value: boolean) {
		if (isFocusable(this.base)) {
			this.base.focused = value;
		}
	}

	get wantsKeyRelease(): boolean | undefined {
		return this.base.wantsKeyRelease;
	}

	get onSubmit(): ((text: string) => void) | undefined {
		return this.base.onSubmit;
	}

	set onSubmit(handler: ((text: string) => void) | undefined) {
		this.base.onSubmit = handler;
	}

	get onChange(): ((text: string) => void) | undefined {
		return this.base.onChange;
	}

	set onChange(handler: ((text: string) => void) | undefined) {
		this.base.onChange = handler;
	}

	get borderColor(): ((str: string) => string) | undefined {
		return this.base.borderColor;
	}

	set borderColor(handler: ((str: string) => string) | undefined) {
		if (this.base.borderColor !== undefined) {
			this.base.borderColor = handler;
		}
	}

	get onEscape(): (() => void) | undefined {
		return this.customBase?.onEscape;
	}

	set onEscape(handler: (() => void) | undefined) {
		if (this.customBase) {
			this.customBase.onEscape = handler;
		}
	}

	get onCtrlD(): (() => void) | undefined {
		return this.customBase?.onCtrlD;
	}

	set onCtrlD(handler: (() => void) | undefined) {
		if (this.customBase) {
			this.customBase.onCtrlD = handler;
		}
	}

	get onPasteImage(): (() => void) | undefined {
		return this.customBase?.onPasteImage;
	}

	set onPasteImage(handler: (() => void) | undefined) {
		if (this.customBase) {
			this.customBase.onPasteImage = handler;
		}
	}

	get onExtensionShortcut(): ((data: string) => boolean | undefined) | undefined {
		return this.customBase?.onExtensionShortcut;
	}

	set onExtensionShortcut(handler: ((data: string) => boolean | undefined) | undefined) {
		if (this.customBase) {
			this.customBase.onExtensionShortcut = handler;
		}
	}

	onAction(action: AppKeybinding, handler: () => void): void {
		this.customBase?.actionHandlers.set(action, handler);
	}

	render(width: number): string[] {
		return this.base.render(width);
	}

	invalidate(): void {
		this.base.invalidate();
	}

	getText(): string {
		return this.base.getText();
	}

	getExpandedText(): string {
		return getExpandedEditorText(this.base);
	}

	setText(text: string): void {
		this.base.setText(text);
	}

	addToHistory(text: string): void {
		this.base.addToHistory?.(text);
	}

	insertTextAtCursor(text: string): void {
		this.base.insertTextAtCursor?.(text);
	}

	setAutocompleteProvider(provider: Parameters<NonNullable<EditorComponent["setAutocompleteProvider"]>>[0]): void {
		this.base.setAutocompleteProvider?.(provider);
	}

	setPaddingX(padding: number): void {
		this.base.setPaddingX?.(padding);
	}

	setAutocompleteMaxVisible(maxVisible: number): void {
		this.base.setAutocompleteMaxVisible?.(maxVisible);
	}

	handleInput(data: string): void {
		if (matchesKey(data, HOTKEY)) {
			this.saveDraft(getExpandedEditorText(this.base));
			this.base.setText(this.getCommandText());
			this.base.handleInput("\r");
			return;
		}

		this.base.handleInput(data);
	}
}

export default function editSessionInPlace(pi: ExtensionAPI) {
	const draft: DraftState = {};
	pi.registerCommand(COMMAND_NAME, {
		description: `Select and re-edit a previous user message on the current branch (${HOTKEY_LABEL})`,
		handler: async (_args, ctx) => {
			await handleEditTurn(ctx, draft);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		draft.value = undefined;
		if (ctx.mode === "tui") {
			const previousEditorFactory = ctx.ui.getEditorComponent();
			ctx.ui.setEditorComponent((tui, theme, keybindings) => {
				const baseEditor = previousEditorFactory?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
				return new EditSessionInPlaceEditor(baseEditor, () => getEditTurnCommandText(pi.getCommands()), (value) => {
					draft.value = value;
				});
			});
		}
	});

	pi.on("session_shutdown", async () => {
		draft.value = undefined;
	});
}
