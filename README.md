# pi edit-session-in-place

A [pi](https://github.com/earendil-works/pi-mono) extension that lets you rewind to an earlier user message in the current branch, then either **edit it in place** or **delete it and continue from there**.

## Compatibility

Requires Pi `0.84.0` or later and Node.js `>=22.19.0`.

Local development pins `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` to the official `0.86.1` cohort. CI tests that version and the maintained [`fitchmultz/pi` fork at `f371064`](https://github.com/fitchmultz/pi/commit/f371064864ef239d66a81ee645a6774dc525be40); the declared `0.84.0` floor is not a CI lane. Pi core packages remain optional wildcard peers because the extension uses Pi's bundled runtime packages rather than installing another copy.

## What it does

- Adds `/edit-turn`
- Adds a main-editor hotkey: `Ctrl+Shift+E`
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

Restart Pi after installing or updating the extension to load its code.

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
- Assistant rewriting uses Pi's private `SessionManager` mutation methods because the public extension context is read-only. These methods are tested against the selected Pi host (official development baseline 0.86.1); an unsupported runtime fails closed before navigation. A cancellation or failure after append may leave an abandoned attempt in the append-only tree; successful restoration returns to the prior branch, while cancelled restoration leaves the last synchronized manager/live-context position active
- If the selected message contains images, the extension warns that re-editing or deleting it will drop the images and keep only text behavior
- The extension only offers text-bearing user messages by default; `Ctrl+A` also includes text-bearing assistant messages. Image-only or whitespace-only user messages are skipped
- Queued messages must be cleared before using the command
- Repeated hotkeys or `/edit-turn` commands are ignored while an edit operation is running, including while waiting for an interrupted response to settle
- The hotkey's expanded draft is restored on cancellation or a rejected editing callback; successful user edits/deletes replace it as described above
- On Pi 0.85.1 or later, `Ctrl+Shift+E` uses Pi's registered shortcut and explicit native extension-command dispatch when the main editor is stock. The extension does not replace the stock editor just for a hotkey
- On older runtimes, or when another extension already configured a custom editor, the existing hotkey wrapper remains. Arbitrary custom editors need not forward registered shortcuts
- On checkpoint-capable Pi forks, an idle stock editor needs no shutdown/checkpoint hook from this extension. Temporary drafts return to the native editor before command completion. Genuine drafts, open dialogs, active callbacks, queued input, and custom-editor memory remain subject to native checkpoint guards; other extensions may still prevent sleep
- Native shortcuts follow Pi's focus and shortcut-conflict rules. A pending asynchronous custom-UI factory can leave the editor focused until it mounts; this is a native Pi limitation shared with the older wrapper path

## Development

For local development you can point pi at the extension directly:

```bash
pi -e ./extensions/edit-session-in-place.ts
```

Local verification:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

That runs:

- `npm test` — strictly compiles the extension and TypeScript tests to `.test-dist/`, then runs Node's built-in test runner, including real `createAgentSession()` navigation tests
- `npm run check:package` — creates an npm tarball, installs it offline in a temporary project, and uses the selected host's native `DefaultResourceLoader` to verify the installed package loads and registers `/edit-turn`

`npm run check:compat` remains the tests-only entry point for external compatibility callers. `npm run typecheck` is available separately; the normal check already type-checks the same sources while compiling the tests. `npm run verify` and `prepublishOnly` run the full test and package-load check. These extension checks make no model calls and require no extension production build or `prepare` step.

The required `compatibility / compatibility` check runs on pull requests and pushes to `main` in one Ubuntu/Node 24 job with an eight-minute timeout. It tests the pinned official Pi release, then builds and installs the pinned fork's SDK cohort with npm. Before repeating the tests and package-load check, it verifies that the installed SDK packages match the built fork. CI does not separately test other Node versions or operating systems.

`PI_COMPAT_EXPECTED_VERSION` and `PI_COMPAT_EXPECTED_PACKAGE_DIR` verify both the imported version and resolved package root; `PI_HOST_INDEX`, when supplied, must resolve to the same SDK. With no overrides the test asserts the pinned development baseline and local installed package. A version string alone cannot identify the fork. Run `npm ci --ignore-scripts --no-audit --no-fund` to restore the official dependency graph after a local fork qualification.

Current regression coverage in `tests/edit-session-in-place.test.ts` includes:

- message extraction from mixed session content
- optional assistant-message inclusion
- selected-host assistant edit/delete semantics through public `createAgentSession()` runtimes after direct user prompts and `user → assistant(tool) → toolResult` chains
- preservation of custom-message, custom-role, compaction, and metadata parents
- guarded writable-session incompatibility before navigation, replacement/restoration double cancellation, and failure restoration
- oldest-to-newest ordering for the picker
- skipping image-only and whitespace-only user messages
- preserving the image-warning flag for mixed text+image messages
- `$VISUAL`/`$EDITOR` resolution rules
- external editor command parsing with quoting/escaping
- trimming exactly one trailing newline from external-editor output
- clearing hotkey drafts across session replacement lifecycle boundaries

`tests/native-shortcut.test.ts` covers dispatch and queued-message guards. `tests/draft-ownership.test.ts` covers callback rejection, repeated hotkeys/commands, and retry after completion on both editor paths.

## Files

- `extensions/edit-session-in-place.ts` — publishable extension implementation
- `tests/edit-session-in-place.test.ts` — regression tests for message extraction, ordering, and external-editor helpers
