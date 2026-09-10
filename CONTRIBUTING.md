# Contributing

Thanks for helping improve the DueVinci Coursework Importer. This project is
in beta, so reports from real course pages are especially useful.

## Local setup

Requirements: Node.js 20 or newer and Chrome for live testing.

```sh
npm install
npm test
npm run chrome:test
```

Load `extension/` as an unpacked extension from `chrome://extensions`.
Keep a signed-in DueVinci tab open when testing imports. Use a test account and
never commit credentials, tokens, downloaded course documents, or private page
captures.

## Pull requests

- Keep scanners review-first: never send coursework without an explicit user action.
- Do not collect grades, submissions, student details, or whole-page HTML.
- Add or update a fixture when changing a school-specific adapter.
- Run `npm test` and describe any live-browser verification in the pull request.
- Keep stable source IDs deterministic so repeated scans update rows instead of duplicating them.

## Reporting a school-page issue

Use the bug-report template and include the school adapter, browser version,
the page type (term page, course page, pacing guide, or syllabus), and the
observed versus expected preview. Remove names, email addresses, tokens, and
private coursework content from screenshots.
