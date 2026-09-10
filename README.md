# DueVinci Coursework Importer

[![Validate extension](https://github.com/saappleg/duevinci-coursework-importer/actions/workflows/validate.yml/badge.svg)](https://github.com/saappleg/duevinci-coursework-importer/actions/workflows/validate.yml)
[![Beta](https://img.shields.io/badge/status-beta-6d4bd8)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A privacy-conscious browser extension for importing coursework from the course page a student has open—without relying on a school’s Canvas API or personal-access-token policy.

The extension source is in [`extension/`](extension/). It supports Chrome and other Chromium browsers directly, and is structured as a Safari Web Extension source package.

This is the companion repository for [DueVinci](https://github.com/saappleg/DueVinci).
The importer writes through the same signed-in DueVinci account and uses the
course/assignment fields documented in the [DueVinci integration guide](https://github.com/saappleg/DueVinci/blob/main/docs/COURSEWORK_IMPORTER_BETA.md).

The popup includes selectable source profiles for WGU, Maestro, Canvas, Moodle,
Blackboard, Brightspace, and generic school pages. **Auto-detect** is the default;
the selected profile is remembered locally for the next scan. The scanner stays
review-first for every profile, so a new school can be tested without an API or
personal access token.

## What it does

1. The student opens an LMS page that lists assignments, quizzes, modules, or coursework.
2. From the extension popup, they explicitly choose **Scan current course page**.
3. The extension detects likely coursework titles, due dates, types, and source URLs locally in the page.
4. The student selects the detected items to approve.
5. The extension writes only those approved items into the signed-in DueVinci account.

The scan does not collect grades, submissions, student details, or whole-page HTML.

### WGU pacing guides

WGU course pages usually expose a WGU Connect pacing-guide link instead of assignment due dates. For a WGU course, the popup detects that link and asks you to choose the pacing-guide DOCX you downloaded from WGU Connect. The extension reads the week-by-week table locally, keeps the guide's to-do items, and filters out explanatory recommendations such as “scroll to the bottom.” Weekly targets are estimated from the course dates shown on the WGU term classes page when that page is open; otherwise they use the course start date and seven-day pacing intervals.

Chrome may close the action popup while its file chooser is open. After selecting the DOCX, click the DueVinci importer icon again; the parsed weekly items are preserved, then click **Connect** and **Import selected**. If an import fails with a conflict error, reload the unpacked extension so the current collision-free item IDs are used.

Before importing, scan the WGU term page once. The extension saves the complete course-date schedule locally, so you can then move through separate course pages without keeping the term page open. On each course scan, confirm the popup's **Course window** card says **Verified** and lists the expected start/end dates. Its Week chips should end on the course end date (for example, a five-week course maps Week 5 to the end date). If it says **Needs review**, scan the term page again; the importer will still allow a start-date-only estimate, but it will clearly label those targets as estimated.

### Maestro weekly courses

Maestro keeps coursework in a virtualized weekly list rather than exposing direct due dates. The Maestro adapter scrolls through that list, captures every lesson (including cards that are rendered as completed `div` elements), and imports one **Unit** parent for each weekly subject. The unit and its linked lesson rows all use the end of that week's range as their target date; lessons are shown beneath the unit with a `↳` prefix. The final card in each week is imported as a review; the final review in the course is imported as an exam. It also reads the **Course syllabus** panel for the official course name, description, and objectives, then closes the panel when it opened it. A full Maestro course scan is still review-first, and the preview should show the complete item count before import.

## DueVinci data contract

The adapter follows the current DueVinci GitHub source. It authenticates with the access token from an already signed-in `duevinci.tech` tab and writes through Supabase using the public app key. It upserts one row in `courses`, then selected rows in `assignments`.

Course rows use `name`, `code`, `emoji`, `color`, `user_id`, `lms_provider`, `lms_source_id`, and `updated_at`. WGU and Maestro imports also send `start_date`, `end_date`, `pacing_type: weekly`, and `pacing_source`; both adapters can send course `description` and objectives (stored in DueVinci's `objectives` field). Apply DueVinci migration `20260909090000_wgu_weekly_pacing.sql` before enabling the date fields in a deployed environment. Assignment rows use `course_id`, `user_id`, `title`, `unit_number` (the WGU/Maestro week number), `due_date`, `task_type`, `type`, `priority`, `is_completed`, `lms_provider`, `lms_source_id`, and `lms_updated_at`.

`lms_source_id` makes repeated scans idempotent against DueVinci’s existing unique constraints. Maestro unit rows use the weekly subject as the title and the week number as `unit_number`; their child rows begin with `↳` so DueVinci renders them as linked lessons beneath the unit. The extension maps quizzes to DueVinci’s `exam` task type and other detected coursework to `lesson`.

## Install in Chrome

1. Run `npm run extension:validate`.
2. Visit `chrome://extensions` and turn on **Developer mode**.
3. Choose **Load unpacked** and select the [`extension/`](extension/) folder.
4. Open a school course page, click the extension, connect the signed-in DueVinci tab, scan, review, and import.

## Beta feedback

This project is actively being tested with WGU and Maestro accounts. Use the
[beta bug report](https://github.com/saappleg/duevinci-coursework-importer/issues/new?template=bug_report.md)
for missing lessons, incorrect unit dates, syllabus parsing problems, or
duplicate imports. The extension also links to this report form from its beta
announcement. Always use a test account and redact private coursework before
sharing screenshots or page details.

The extension requests school-page access only through the browser’s `activeTab` permission, after the user clicks Scan. WGU term-date matching uses fixed access to `my.wgu.edu` and `wguconnect.wgu.edu`; no other school origin is permanently granted.

## Package for Safari

On macOS with Xcode installed, package the same source using:

```sh
xcrun safari-web-extension-packager extension --project-location safari --app-name "DueVinci Coursework Importer" --swift
```

Open the generated Xcode project, review the manifest compatibility warnings, run the macOS app target, and enable the extension in Safari. Apple’s current documentation names `safari-web-extension-packager`; it notes that `safari-web-extension-converter` was the previous command name. [Apple packaging documentation](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)

## Scanner coverage

There are lightweight DOM adapters for Canvas, Moodle, Blackboard, and Brightspace plus a generic semantic fallback. The extension is intentionally review-first: a school’s markup can change, so nothing is written until the student sees and selects it. Add a school-specific selector set in [`extension/scanner.js`](extension/scanner.js) when a particular LMS page needs more precise parsing.
