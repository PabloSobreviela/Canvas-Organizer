# Open Design Mobile Experiment

This mobile UI pass uses the locally installed Open Design bundle rather than a 1:1 recreation of the existing desktop app.

## Open Design Inputs

- Skill: `frontend-design`
- Design system: `design-systems/application`
- Craft references: `craft/typography.md`, `craft/color.md`, `craft/anti-ai-slop.md`
- Frame target: iPhone 15 Pro, `390x844`

## Direction

The mobile app should keep the minimum CanvasSync workflows:

- Weekly assignments with completion controls
- Month agenda
- Class selection and course detail
- Sync status and sync action

The interface intentionally diverges from the current dark desktop UI. The mobile shell uses Open Design's Application tokens: light neutral background, white surfaces, practical hierarchy, restrained blue action color, compact type, and explicit semantic states.

## Calendar UX Decisions

- Month view is for broad date scanning. It keeps a month-level agenda that helps users inspect which dates have work.
- Week view is for near-term planning. It uses a seven-day rail, workload counts, selected-day tasks, and a short upcoming queue instead of repeating the month agenda pattern.
- Primary assignment fields are subject/course code, assignment title, category, and due date/time. The active Qwen extraction prompt only asks the model to return `cc`, `nam`, `due`, and `cat`; resync adds `action` and `changes_summary`, which are secondary audit metadata.
- Day-of-week context matters for assignments and deadlines, so the mobile UI keeps weekday labels visible and uses attention states only for actionable problems such as overdue, missing date, or review.
- The week UI should reduce visual clutter: show counts in the rail, then show full task detail only for the selected day. Avoid repeating source pills, date-work explanations, or idle loading bars on every card.
- Sync progress is active feedback, not permanent chrome. Show it while syncing, animate the bar smoothly, flash green on completion, then return to the quiet mobile shell.

## Calendar App References

- Todoist separates calendar layout from Upcoming planning so users can either scan schedule gaps or organize the near-term week.
- Google Calendar only places dated tasks on the calendar, keeping undated/pending task management separate.
- TickTick and Fantastical use multiple calendar densities so the same app can support quick overviews and detailed day/week planning without making every view equally dense.

Desktop UI is intentionally unchanged for this experiment.
