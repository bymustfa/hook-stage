# Good first issues

These are concrete follow-ups. They are not open as GitHub issues yet. Labels to apply when opening them are listed on each item.

## 1. Add a `not-equals` assertion operator

The verification panel only offers `equals` and `exists`. Add `not-equals` to the scenario schema, the evaluator, the editor, and a unit test. Keep JSON Pointer. Do not add an expression language.

Labels: `good first issue`, `enhancement`

## 2. Light theme

The WebUI ships a single dark cue-sheet theme. Add a light theme and a toggle that persists in `localStorage`. Keep contrast for the HTTP and business status chips.

Labels: `good first issue`, `enhancement`

## 3. Keyboard shortcut to run the active flow

Document and implement a shortcut that opens the run preview for the selected tab, without starting the run until the reset choice is confirmed.

Labels: `good first issue`, `enhancement`

## 4. Diff normal and modified delivery plans

Show a small diff of event key, event id, and `atMs` between the two flows so a reviewer can see the injected fault without reading both card lists.

Labels: `good first issue`, `enhancement`

## 5. Remember the last opened scenario

Persist the selected scenario id in `localStorage` and restore it on the next visit. Fall back to the seeded example when the id is gone.

Labels: `good first issue`, `enhancement`

## 6. Export a run report as CSV

Add a button on a finished run that downloads delivery rows (planned time, actual time, HTTP status, latency) and assertion rows (pointer, expected, actual, passed). Do not include the raw target URL if it can be derived only from the local profile.

Labels: `good first issue`, `enhancement`

## 7. Surface non-2xx response excerpts in the timeline

Delivery rows store a response excerpt, but the timeline emphasizes status and latency. Show the excerpt inline when the outcome is not a 2xx.

Labels: `good first issue`, `enhancement`

## 8. Sample fixture for a stock reservation

Add a third fixture and a short section in both READMEs: reserve, then a late duplicate reservation, with a state assertion that quantity was decremented once. Keep the data synthetic.

Labels: `good first issue`, `documentation`
