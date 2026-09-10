# Changelog

## 0.1.0-beta.1

### Added

- WGU term-date matching and pacing-guide DOCX import.
- Maestro weekly-unit, lesson, review, exam, and syllabus import.
- Review-first imports for Canvas, Moodle, Blackboard, Brightspace, and generic course pages.
- Deterministic source IDs for repeat-safe DueVinci imports.
- Chrome test build and beta feedback link.

## 0.1.1-beta.2

### Fixed

- Hardened popup and background storage access when a browser does not expose
  the WebExtension storage namespace yet.
- Published a new Chrome test package so older unpacked builds can be replaced
  instead of continuing to report the `storage.local` error.

### Release assets

- Added separate Chrome/Chromium and Safari Web Extension source ZIPs to the
  GitHub beta release workflow.
