# pi edit-session-in-place

A [pi](https://github.com/earendil-works/pi-mono) extension that lets you rewind to an earlier user message in the current branch, then either **edit it in place** or **delete it and continue from there**.

## Compatibility

Tested with:

- `@earendil-works/pi-coding-agent` `0.80.6`
- `@earendil-works/pi-tui` `0.80.6`
- Node.js `>=22 <25`

Local development and verification in this repo target pi `0.80.6` as the suggested minimum tested baseline. `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` stay in `devDependencies` for local typechecking and tests, while pi core packages are declared as optional wildcard peers and the extension relies on pi's bundled runtime packages at execution time. That keeps installs forward-open for future pi releases: npm peer ranges should not block users from trying a newer pi, though runtime behavior is only verified against the tested baseline until a follow-up package release confirms it.

## What it does

- Adds `/edit-turn`
- Adds a global hotkey: `Ctrl+Shift+E`
- Lets you choose an earlier user message from the current branch
- Press `Ctrl+A` in the picker to also show assistant messages
- Rewinds pi to that point in the same session file
- Loads edited user text back into the main editor, or writes an edited assistant response onto a new branch
- Treats an empty submit as **delete this message and continue from here**

## Install

Install from npm with pi:

```bash
pi install npm:pi-edit-session-in-place
```

Or install directly from GitHub with pi:

```bash
pi install https://github.com/fitchmultz/pi-edit-session-in-place
```

Then reload pi from inside the app with:

```text
/reload
```

## Usage

Inside pi:

```text
/edit-turn
```

Or press:

```text
Ctrl+Shift+E
```

### Message picker behavior

- Shows earlier user messages from the current branch only by default
- `Ctrl+A` toggles assistant messages into the same picker
- Uses a viewport so long threads stay navigable
- Orders messages **oldest → newest**
- Starts with the **newest** message selected at the bottom
- `↑` moves to older messages, `↓` moves to newer ones
- `PageUp` / `PageDown` jump faster

### Editor behavior

- `Ctrl+X` clears the entire selected message instantly
- `Enter` submits the edited message
- `Shift+Enter` inserts a newline
- `Escape` cancels without changing history
- `Ctrl+G` opens your external editor if `$VISUAL` or `$EDITOR` is set; parse or launch failures are reported as warnings

If you clear a user message and submit an empty value, the selected message is effectively deleted: pi rewinds to just before that message and leaves the main editor empty so you can type a new prompt. If you clear an assistant message, pi creates a branch that keeps everything before that response—including tool results, custom messages, compactions, and metadata—without the selected response.

## Behavior notes

- Works in interactive TUI mode; non-interactive and RPC modes do not show the picker/editor UI
- Later messages on the abandoned branch are not deleted from the session file; they remain reachable through `/tree`
- Assistant rewriting uses a guarded private Pi 0.80.6 `SessionManager` compatibility path because the public extension context is read-only. Incompatible runtimes reject the operation before navigation. A cancellation or failure after append may leave an abandoned attempt in the append-only tree; successful restoration returns to the prior branch, while cancelled restoration leaves the last synchronized manager/live-context position active
- If the selected message contains images, the extension warns that re-editing or deleting it will drop the images and keep only text behavior
- The extension only offers text-bearing user messages by default; `Ctrl+A` also includes text-bearing assistant messages. Image-only or whitespace-only user messages are skipped
- Queued messages must be cleared before using the command
- The `Ctrl+Shift+E` hotkey is handled by this extension's main-editor component so Pi's registered shortcut dispatcher does not consume it first
- The hotkey component wraps any previously configured custom editor when possible instead of replacing it

## Development

For local development you can point pi at the extension directly:

```bash
pi -e ./extensions/edit-session-in-place.ts
```

Local verification:

```bash
npm run verify
```

That runs:

- `npm test` — compiles the TypeScript test fixtures to `.test-dist/` and runs them with Node's built-in test runner
- `npm run typecheck` — strict TypeScript type-checking
- `npm pack --dry-run` — publishability check for the npm package contents

Current regression coverage in `tests/edit-session-in-place.test.ts` includes:

- message extraction from mixed session content
- optional assistant-message inclusion
- real Pi 0.80.6 assistant edit/delete semantics after direct user prompts and `user → assistant(tool) → toolResult` chains
- preservation of custom-message, custom-role, compaction, and metadata parents
- guarded writable-session incompatibility before navigation, replacement/restoration double cancellation, and failure restoration
- oldest-to-newest ordering for the picker
- skipping image-only and whitespace-only user messages
- preserving the image-warning flag for mixed text+image messages
- `$VISUAL`/`$EDITOR` resolution rules
- external editor command parsing with quoting/escaping
- trimming exactly one trailing newline from external-editor output
- clearing hotkey drafts across session replacement lifecycle boundaries

## Files

- `extensions/edit-session-in-place.ts` — publishable extension implementation
- `tests/edit-session-in-place.test.ts` — regression tests for message extraction, ordering, and external-editor helpers
