# CanvasSync UI Refresh Plan

## Visual Principles
- Treat CanvasSync as a calm academic task timeline, not a dashboard.
- Keep assignment names primary, due times aligned, and labels small but readable.
- Use compact rows with quiet dividers and softened completed states.
- Use restrained motion and hover/focus states only; no 3D, confetti, glow-heavy effects, or prototype routes.

## Row Hierarchy
- Day header: weekday, date, and a small Today/Tomorrow/Past due cue when relevant.
- Row left: completion checkbox with a clear hit target.
- Row center: assignment title first, then course/category/source labels.
- Row right: due time and urgency label aligned for scanning.

## Spacing Scale
- Page gutters: 24px.
- Day sections: 16-24px vertical separation.
- Rows: 10-12px vertical padding.
- Pills: 4-8px horizontal padding, 1px borders.

## Color Roles
- Background: black/zinc for continuity with the existing app.
- Primary action: blue, used sparingly for buttons and current-day cues.
- Course identity: existing course palette.
- Urgency: red for overdue/today, amber for tomorrow/review, zinc for neutral.
- Completion: green only for checked state; completed rows are muted.

## Source/Status Pill Mapping
- `canvasAssignmentId` or Canvas-like `sourceOfTruth`: `Canvas`.
- `discoveredKey` or materials-like `sourceOfTruth`: `From materials`.
- `status === "RESOLVED"`: `Date updated`.
- `status === "CONFLICT"`: `Review date`.
- Missing due date: `No date yet`.
- Unknown source stays broad and does not invent file names, page numbers, snippets, or confidence.

## Files To Edit
- `frontend/src/App.js`: landing copy/preview, weekly timeline rows, source/status pills, sync progress copy.
- `frontend/src/index.css`: tiny shared focus/animation polish only if needed.

## Surfaces To Change
- Signed-out landing page.
- Weekly view task list.
- Assignment source/status labels in weekly/calendar/course surfaces.
- Existing sync toolbar popover and sync phase copy.

## Surfaces Not To Change
- Backend files.
- API request/response contracts.
- Routing, including no `/ui-northstar` or prototype route.
- Authentication, legal pages, account data actions, and demo bootstrap behavior.
- Dependencies and package metadata unless the build requires it.

## Risks
- `frontend/src/App.js` is large and already modified in the worktree, so edits should stay localized.
- Existing cached assignment rows may not always include `sourceOfTruth`; labels must degrade honestly.
- Sync progress can only show phases available in client state.
