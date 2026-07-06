# Mobile Interaction Audit

Internal checklist for the Open Design mobile pass. The phone target is 390 x 844.

## Feedback Rules

- Use inline state for direct manipulation: filters, date selection, task completion, class selection.
- Use the native mobile notice rail for async success, warning, and error feedback.
- Keep sync progress visible only while active, then show a readable completion state before it exits.
- Errors name what failed and provide the next useful action when one exists.
- No Sileo notifications, browser alerts, or browser confirmations in the mobile application shell.
- Respect `prefers-reduced-motion`.

## Motion Decisions

- Tab changes: short fade and 4 px rise; the old 400 ms transition felt sluggish.
- Week/month changes: short content swap; navigation controls themselves do not animate.
- Day selection: selected-day content swaps, while the seven-day rail stays stable.
- Task completion: icon pop and quiet row-color transition; no toast.
- Class selection: color/check transition is sufficient; no extra animation.
- Sync progress: smooth width interpolation is useful; a restrained indeterminate sheen covers long phases.
- Success/error notices: enter once and leave once; persistent errors wait for dismissal or retry.
- Dialogs: backdrop fade and small panel rise; no scale-heavy bounce.

## Entry And Legal

- [x] Sign in header button
- [x] Sign in with Canvas primary action
- [x] Try Demo link
- [x] Landing preview completion buttons
- [x] Consent checkbox and legal links
- [x] Consent submit disabled, saving, success, and error states
- [x] Authentication loading state
- [x] Demo starting state
- [x] Demo unavailable error and exit action

## Demo And Header

- [x] Demo intro exit action
- [x] Demo intro continue action
- [x] Brand / return-to-landing action
- [x] Account options action
- [x] Exit demo action
- [x] Sync disabled, ready, active, success, warning, and error states

## Week

- [x] Previous week
- [x] Today
- [x] Next week
- [x] Assignment filter toggle
- [x] Exam filter toggle
- [x] Seven day-selection buttons
- [x] Task complete / incomplete buttons
- [x] No synced data state
- [x] No work this week state
- [x] Filters-hide-all state and reset action
- [x] Empty selected-day state

## Calendar

- [x] Previous month
- [x] Today
- [x] Next month
- [x] Category filter toggles
- [x] Task complete / incomplete buttons
- [x] No dated items state
- [x] Filters-hide-all state and reset action

## Classes And Course

- [x] Select / edit classes
- [x] Open course row
- [x] Cancel class editing
- [x] Save class selection
- [x] Course selection toggles
- [x] Clear-all selection state
- [x] Back to classes
- [x] Open Classes from unsynced course
- [x] Unsynced and no-items course states
- [x] Course sync progress, success, warning, and failure states

## Account And Data

- [x] Close account dialog
- [x] Account, Settings, and Upgrade tabs
- [x] Font selection and close
- [x] Plan selection, cancel, close, and confirmation
- [x] Canvas connect validation, loading, success, warning, and failure
- [x] Canvas disconnect success and failure
- [x] Data export loading, success, and failure
- [x] Data deletion confirmation, loading, success, and failure

## Bottom Navigation

- [x] Week
- [x] Calendar
- [x] Classes
