# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

## [0.1.24] - 2026-07-11

### Fixed
- scoped hotkey draft state to each extension instance and clear it on session lifecycle boundaries so reload, new, resume, and fork flows cannot restore a stale draft
- made assistant edits and deletes preserve the full preceding branch when the response follows tool results, custom messages, compactions, or metadata; direct user and custom-message parents dropped by Pi navigation are replayed
- validate the Pi 0.80.6 private writable `SessionManager` adapter before navigation, and keep the manager leaf and live agent context synchronized even when both replacement navigation and restoration are cancelled

### Changed
- updated the local Pi development and verification baseline to `0.80.6`

### Tests
- added real Pi 0.80.6 `SessionManager`/`AgentSession.navigateTree` regression coverage for assistant edit/delete after tool results, custom/compaction/metadata parent preservation, incompatible adapters, double cancellation, and post-navigation failure restoration
- added regression coverage for draft clearing across replacement-session startup

## [0.1.23] - 2026-06-26

### Added
- `Ctrl+A` in the edit picker now toggles text-bearing assistant responses into the selectable list while keeping the default user-message-only picker unchanged
- assistant responses can be rewritten onto a new branch, or removed by submitting an empty edit

### Tests
- added regression coverage for optional assistant-message extraction

## [0.1.22] - 2026-06-24

### Fixed
- picker timestamps now render in the local timezone instead of the raw UTC session timestamp, so the message list shows the times users expect for their timezone (with a safe fallback for malformed timestamps)
- removed the stale `basic-ftp` npm `overrides` entry: the transitive advisory that prompted it (0.1.4) is long resolved, `npm ls basic-ftp` is empty, and `npm audit` is clean

### Changed
- reconciled the local development install against pi `0.80.2`: `node_modules` and `package-lock.json` now resolve `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` to the declared devDependency range. The 0.1.21 bump declared `0.80.1` but the installed tree was still pinned to `0.79.10`, so local typechecks ran against stale types
- refreshed README compatibility notes for pi `0.80.2` and aligned the documented Node.js floor with the `engines.node` field (`>=22 <25`)

### Tests
- added non-circular `formatTimestamp` regression coverage under fixed timezones (UTC, America/New_York, Pacific/Auckland) and malformed-input/padding cases, so timestamp behavior is pinned independently of the production helper

### Validation
- ran `npm run verify` (tests, strict typecheck, `npm pack --dry-run`), `npm audit`, and a live `pi -e` extension load under pi `0.80.2`

## [0.1.21] - 2026-06-23

### Changed
- updated the local pi development baseline to `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` `0.80.1` and refreshed the npm lockfile
- refreshed README compatibility notes for pi `0.80.1`
- reviewed the Pi 0.80.0/0.80.1 changelog; no runtime source migration was required

### Validation
- Pending in this release train.

## [0.1.20] - 2026-06-22

### Changed
- updated the local pi development baseline to `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` `0.79.10` and refreshed the npm lockfile
- refreshed README compatibility notes for pi `0.79.10` and removed the obsolete fleet-tested marker

### Validation
- ran `npm run verify` and an isolated Pi package-load smoke under pi `0.79.10`

## [0.1.19] - 2026-06-15

### Changed
- updated the local pi development baseline to `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` `0.79.4` and refreshed the npm lockfile

### Validation
- ran `npm run verify` under pi `0.79.4`

## [0.1.18] - 2026-06-05

### Fixed
- preserved expanded editor text when the edit hotkey or external-editor path sees pi paste markers
- wrapped any existing custom editor when installing the `Ctrl+Shift+E` hotkey path, while preserving app action handlers for `CustomEditor`-style bases
- reported malformed or failing `$VISUAL` / `$EDITOR` launches as warnings instead of silently ignoring them

## [0.1.17] - 2026-06-04

### Fixed
- fixed the editor hotkey command dispatch when duplicate installs suffix the command as `/edit-turn:1`, `/edit-turn:2`, etc.
- removed the local project package setting accidentally left by release verification so the repo no longer loads a duplicate project copy during local reloads

## [0.1.16] - 2026-06-04

### Fixed
- fixed `Ctrl+Shift+E` after the Pi 0.78.1 update by removing the registered shortcut handler that consumed the key and only showed the placeholder notification
- added regression coverage that verifies the extension no longer registers a conflicting shortcut handler and still installs the custom editor hotkey path

### Changed
- removed the custom main-editor wrapper path and returned to the focused custom-editor hotkey path used by the working releases

## [0.1.15] - 2026-06-04

### Changed
- updated the local pi development baseline to `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` `0.78.1` and regenerated the npm lockfile
- refreshed README compatibility notes and the fleet-tested pi marker for `0.78.1` without pinning pi `0.78.1` as a hard runtime requirement
- changed the main-editor integration to wrap any previously configured custom editor instead of replacing it

### Compatibility
- reviewed the pi `0.78.1` changelog and current extension, TUI, custom editor, mode, session, and package guidance; the extension now guards custom TUI behavior with `ctx.mode === "tui"` and keeps existing custom editors composed
- confirmed the new `ctx.getSystemPromptOptions()` command API, provider additions, package-install hardening, and security fixes do not require additional runtime changes for this package

## [0.1.14] - 2026-05-29

### Changed
- updated the local pi development baseline to `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` `0.78.0` and regenerated the npm lockfile
- aligned package tooling metadata with the pi fleet policy: `packageManager` now records the npm 11 major line and `engines.node` is `>=22 <25`
- refreshed README compatibility notes and the fleet-tested pi marker for `0.78.0`

### Compatibility
- reviewed the pi `0.78.0` changelog and current extension, TUI, session, and package guidance; the extension continues to use supported command, shortcut, custom editor, and session tree APIs
- confirmed the new startup session naming, file-link rendering, provider, and argument parsing changes do not require runtime changes for this package

## [0.1.13] - 2026-05-28

### Changed
- updated the local pi development baseline to `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` `0.77.0` and regenerated the npm lockfile
- kept pi runtime packages as optional wildcard peers and removed the Node.js engine upper bound so future pi releases are not blocked at install time

### Compatibility
- reviewed the pi `0.77.0` changelog and package guidance; the extension still uses supported command, shortcut, and session APIs

## [0.1.12] - 2026-05-27

### Changed
- updated the local pi development baseline to `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` `0.76.0` and regenerated the npm lockfile

### Compatibility
- reviewed the pi `0.76.0` changelog and package guidance; the extension still uses supported command, shortcut, and session APIs

## [0.1.11] - 2026-05-23

### Changed
- updated the local pi development baseline to `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` `0.75.5`, refreshed Node tooling, and regenerated the npm lockfile

### Compatibility
- reviewed the pi `0.75.5` changelog and package guidance; the extension still uses supported command, shortcut, and session APIs

## [0.1.10] - 2026-05-18

### Changed
- updated the local pi development baseline to `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` `0.75.3` and refreshed the npm lockfile
- raised the documented Node.js tooling floor to `>=22.19.0`
- removed legacy Ralph task metadata and ignored local `.cueloop/` runtime state

### Compatibility
- reviewed current pi `0.75.3` package and extension guidance; the extension continues to use supported command, shortcut, and session APIs


## [0.1.9] - 2026-05-07

### Changed
- migrated the local pi development baseline and peer metadata from deprecated `@mariozechner/*` packages to maintained `@earendil-works/*` `0.74.0`
- regenerated the npm lockfile against the current stable dependency graph

### Compatibility
- reviewed the pi `0.74.0` changelog and confirmed the extension still uses supported command, shortcut, and session APIs

## [0.1.8] - 2026-05-01

### Changed
- updated the local pi development baseline to `@mariozechner/pi-coding-agent` / `@mariozechner/pi-tui` `0.72.0`
- regenerated the npm lockfile against the current stable dependency graph
- aligned pi core peer metadata with current pi package guidance

### Compatibility
- reviewed the pi `0.72.0` changelog and confirmed the extension still uses supported command, shortcut, and session APIs without relying on provider thinking metadata


## [0.1.7] - 2026-05-01

### Changed
- updated the local pi development baseline to `@mariozechner/pi-coding-agent` / `@mariozechner/pi-tui` `0.71.1`
- regenerated the npm lockfile against the current stable dependency graph

### Compatibility
- reviewed the pi `0.71.1` changelog and confirmed the extension still uses supported command, shortcut, and session APIs without relying on removed providers or stale session-replacement objects


## [0.1.6] - 2026-04-23

### Changed
- updated the local pi development baseline to `@mariozechner/pi-coding-agent` `0.70.0`
- regenerated the npm lockfile against the current stable dependency graph

### Compatibility
- reviewed the pi `0.70.0` changelog and confirmed the extension still relies on supported extension APIs without needing the TypeBox migration surface at runtime or the changed terminal progress defaults


## [0.1.5] - 2026-04-21

### Changed
- updated the local pi development baseline to `@mariozechner/pi-coding-agent` `0.68.0`
- regenerated the npm lockfile against the current stable dependency graph

### Compatibility
- reviewed the pi `0.68.0` changelog and confirmed the extension already relies on current extension APIs rather than removed cwd-bound tool exports

## [0.1.4] - 2026-04-18

### Changed
- bumped the local pi development baseline to `@mariozechner/pi-coding-agent` / `@mariozechner/pi-tui` `0.67.68` and `typescript` `6.0.3`
- refreshed the release lockfile against the current stable pi patch line

### Fixed
- pinned the transitive `basic-ftp` dependency to `5.3.0` to clear the current audit finding during verification and publish checks

## [0.1.3] - 2026-04-16

### Changed
- updated the local pi development baseline to `@mariozechner/pi-coding-agent` / `@mariozechner/pi-tui` `0.67.4`
- aligned `packageManager` metadata to `npm@10.9.8`, the latest stable npm line compatible with the declared Node runtime floor
- removed the published `@mariozechner/pi-coding-agent` peer dependency so installs rely on pi's bundled runtime while local development keeps the package in `devDependencies`

## [0.1.2] - 2026-04-15

### Changed
- refreshed the local development and release baseline to pi `0.67.2`, `typescript` `6.0.2`, and `@types/node` `25.6.0`
- pinned `packageManager` to `npm@11.12.1` and updated the README compatibility notes to match the verified pi baseline
- refreshed the compatible transitive development dependency set in the lockfile without changing the published `/edit-turn` runtime behavior

## [0.1.1] - 2026-04-11

### Changed
- tightened local release verification with `npm run verify`, including clean test builds, typechecking, and package dry-run validation
- documented tested runtime compatibility and local development/release workflow in `README.md`
- aligned published pi core package peer dependencies with current official pi package guidance

### Fixed
- hardened external editor handling for `Ctrl+G` by parsing quoted editor commands more reliably and preserving Windows-style paths
- moved temporary editor files into a private temporary directory with safer cleanup
- kept `Ctrl+Shift+E` hotkey behavior working while also registering the shortcut for pi shortcut discovery/diagnostics
- added regression coverage for editor command parsing, environment resolution, and newline trimming
- patched the transitive `basic-ftp` vulnerability via `overrides`

## [0.1.0] - 2026-04-11

### Added
- initial public release of `pi-edit-session-in-place`
- `/edit-turn` command and `Ctrl+Shift+E` hotkey for rewinding and editing or deleting earlier user messages in the current session branch
- picker/editor UI for choosing and editing previous user messages
- regression tests for editable-message extraction and ordering
