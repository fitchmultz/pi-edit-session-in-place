# Changelog

All notable changes to this project will be documented in this file.

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
