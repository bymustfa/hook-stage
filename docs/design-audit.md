# hook-stage WebUI design audit

Audit of the studio in `apps/web` before the visual upgrade. Method: `redesign-existing-projects`. Concrete values to apply afterward come from `landing-page-design` Part B. This is a local scenario dashboard, not a marketing page, so Part A (hero, FAQ, pricing, tagline reveal) is out of scope.

Stack: Vite, React, vanilla CSS in `apps/web/src/styles.css`. No Tailwind. No icon library.

## Typography

- Two display faces plus a third mono face: Fraunces for the wordmark and headings, Outfit for UI, IBM Plex Mono for data. The brief allows one text face. Geist Mono may stay for code and timings.
- Fraunces is used as a display serif, which reads as a styled landing wordmark on a tool.
- Body is 15px and several labels sit at 0.82rem, 0.86rem, 0.78rem, and 1.55rem. None of those are on the type scale.
- Badge text is italic (`<em>`). Italics are not allowed.
- Data columns (planned time, actual time, latency) use a proportional face in places and do not set tabular numbers.
- The wordmark and section titles do not use `text-wrap: balance`. Hint paragraphs do not use `text-wrap: pretty`.

## Color and surfaces

- Surfaces are warm olive (`#10110e`, `#171910`, `#212418`), not the approved neutral dark steps.
- The page background is a radial amber glow. Background gradients are not allowed.
- The mark is an amber to transparent linear gradient with a glow shadow.
- Amber (`#f0b429`), green (`#3dbe86`), and coral (`#ef5d4c`) compete. Pass, fail, and the primary button are three accents. Focus rings and the target URL reuse the amber.
- Selected cards use a one sided amber inset shadow. A border must go all the way around or not exist.
- Cards combine a border, a tinted gradient fill, and a shadow. That is the generic card recipe.
- Shadows are pure black at low opacity, not tied to one light direction.

## Layout

- The shell is `min-height: 100vh`, which jumps on mobile browsers. `100dvh` is the replacement.
- Spacing is a mix of `0.45rem`, `0.7rem`, `0.9rem`, and `1.25rem`, off the spacing scale.
- Radius is mostly `16px` or `999px` pills, chosen by feel. Nested controls do not follow outer radius minus gap.
- The header is welded to the top edge.
- Scenarios always occupy a left rail. A collapsible panel fits a storyboard better than a permanent sidebar.
- There is no max width, so on a wide monitor the three panes stretch without a readable measure on hint text.
- The results pair is two equal columns. That is appropriate for a comparison, not a feature marketing row, so it stays.

## Interaction and states

- Hover only recolors a border. There is no pressed state (`scale(0.98)` or a 1px translate).
- Motion uses the browser default. Nothing declares the base curve `cubic-bezier(0.22, 1, 0.36, 1)`.
- Reduced motion support exists and should stay. It currently kills every transition, including opacity. A plain fade is enough.
- Focus rings exist, but they are amber and easy to miss on the dark olive field.
- First load is the sentence "Loading the example scenario…". That should be a skeleton shaped like the rail, cards, and result columns.
- Empty runs say "No run yet." The delivery list has one line of instruction. Both need a composed empty state that names the next action.
- Errors use a banner, which is right, and scenario JSON errors are inline. Discarding edits uses `window.confirm`, which is the same class of problem as `window.alert`.
- Disabled buttons only drop opacity. They should not show a hover affordance.
- There is a favicon. There is no skip link.

## Content

- "Delivered is not the same as done." is specific and should stay.
- Button labels are already sentence case (`Run modified`, `Export JSON`, `Reset fixture and run`).
- Engine headlines such as `all 2xx; business FAILED` are a contract with tests. The audit does not change them.
- Scenario names come from fixture files (`Delayed duplicate payment`). Those stay.

## What the upgrade will not do

- No landing page, no hero section, no FAQ, no tagline reveal, no stock photos, no cookie banner, no fake privacy page. The app is `noindex` because it is a local tool.
- Pass and fail keep two low saturation status colors. Part B does not define semantic status hues, and grayscale alone would hide the product's main distinction. They are not used as brand accents. The primary action is white on black.
- The card list, keyboard sorting, and up or down controls stay. Reordering still moves an event into the destination time slot.

## Fix order

1. Geist, drop Fraunces and Outfit, keep a mono only for JSON and timings.
2. Flat approved dark surfaces. Remove the amber glow and the one sided selection mark.
3. Hover, pressed, and focus states on the base curve.
4. Spacing scale, nested radius, floating header, collapsible scenario panel.
5. Skeleton loading, composed empty states, an inline discard dialog.
6. Type scale and tabular numbers on the timeline.
