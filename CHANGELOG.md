# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

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
