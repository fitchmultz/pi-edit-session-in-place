# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

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
