# pi edit-session-in-place

A [pi](https://github.com/earendil-works/pi) extension that lets you rewind to an earlier user message in the current branch, then either **edit it in place** or **delete it and continue from there**.

## Compatibility

Requires Pi `1.0.0` or later and Node.js `>=24.15.0`. Development and standalone/packed qualification use the official Pi 1.0.0 cohort. CI records the maintained [`fitchmultz/pi`](https://github.com/fitchmultz/pi) fork's exact revision and qualifies supported hosts; an older fork is truthfully recorded as unattempted, not passing. Pi core packages are optional wildcard peers: the extension uses the host's bundled runtime rather than installing another copy.

## What it does

- Adds `/edit-turn` and the `Ctrl+Shift+E` shortcut
- Lets you choose an earlier user message from the current branch
- Press `Ctrl+A` in the picker to also show assistant messages
- Rewinds pi to that point in the same session file
- Loads edited user text back into the main editor, or writes an edited assistant response onto a new branch
- Treats an empty submit as **delete this message and continue from here**

## Install

```bash
pi install npm:pi-edit-session-in-place
```

Or from GitHub:

```bash
pi install https://github.com/fitchmultz/pi-edit-session-in-place
```

Use `/reload` after updating extension source; restart Pi after changing dependencies or the host runtime.

## Usage

Run `/edit-turn` or press `Ctrl+Shift+E`.

### Message picker

- Shows earlier user messages from the current branch, oldest → newest, with the newest selected
- `Ctrl+A` toggles assistant messages into the same picker
- `↑`/`↓` move one message; `PageUp`/`PageDown` jump; mouse clicks select

### Editor

- `Enter` submits; `Shift+Enter` inserts a newline
- `Ctrl+X` clears the entire message
- `Escape` cancels without changing history
- `Ctrl+G` opens `$VISUAL`/`$EDITOR` when set; parse or launch failures are reported as warnings
- Other controls use Pi's native `CustomEditor`/editor bindings, including undo and multiline paste; the embedded editor does not register main-session resend or interrupt actions

Submitting an empty user message deletes it: pi rewinds to just before that message and leaves the main editor empty. Submitting an empty assistant message creates a branch that keeps everything before that response, including tool results, custom messages, compactions, and metadata, without the selected response.

## Behavior notes

- Interactive TUI mode only; non-interactive and RPC modes do not show the picker
- Later messages on the abandoned branch stay in the session file and remain reachable through `/tree`
- Assistant rewriting uses Pi's private `SessionManager` mutation methods because the public extension context is read-only. An unsupported runtime fails closed before navigation. A cancellation or failure after append may leave an abandoned attempt in the append-only tree; the prior branch is restored when possible, and a context-neutral custom entry saves the position so reopening resumes the same conversation
- Editing a message that contains images keeps only its text; the extension asks before dropping images
- Image-only and whitespace-only messages are not offered
- Queued messages must be cleared before using the command
- Repeated shortcuts or `/edit-turn` invocations are ignored while an edit is running, including while an interrupted response settles
- The shortcut's draft is restored on cancellation or a rejected editing callback; successful edits and deletes replace it
- Replacement, fork, resume, reload and shutdown dispose pending dialogs and discard outgoing draft ownership. No late callback may restore that draft into the incoming session or navigate using a stale context
- External editing uses a private temporary file and asynchronous terminal handoff; disposal stops its child, resumes terminal input once and ignores late completion
- Canonical `context_edit` entries intentionally are not used for rewinding: they alter earlier context while retaining later turns, which is not this command's edit/delete-and-continue behavior
- The shortcut follows Pi's focus and shortcut-conflict rules. Custom editors built on Pi's `CustomEditor` receive it natively

## Development

```bash
npm ci --ignore-scripts
npm run check
```

- `npm test` runs `node --test` directly on TypeScript, including real `createAgentSession()` navigation and `InteractiveMode` shortcut/editor/pointer/replacement/external-editor tests in both TUI modes, without model calls or operator UI changes
- Shortcut dispatch belongs to the registered-command boundary tests; avoid exporting a private name-selection helper just to repeat that coverage. Keep controlled draft-rejection tests for faults the native UI scenarios cannot inject.
- `npm run typecheck` runs `tsc` (no emit)
- `npm run check` runs both plus `npm pack --dry-run`; `check:compat` and `prepublishOnly` call it

For interactive testing, load the source directly: `pi -e ./extensions/edit-session-in-place.ts`.

The required `compatibility / compatibility` check records and builds supported fork revisions, then runs the shared [`fitchmultz/.github`](https://github.com/fitchmultz/.github) qualification against official Pi and the fork: package contracts, a fresh Git install, an npm tarball install, and the real bundled Pi CLI. `PI_COMPAT_EXPECTED_VERSION` and `PI_COMPAT_EXPECTED_PACKAGE_DIR` let the tests assert which host they imported; without them the tests assert the pinned official version in local `node_modules`.
