# hook-stage unslop audit

unslop by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Skill: [github.com/heydamir/unslop](https://github.com/heydamir/unslop).

## Level

Light slop. The studio was already a dark instrument: no purple gradients, no gradient text, no emoji, no glow, no hype claims, and no greeting headline. What remained were craft tells and a template-grey finish. The nine passes correct those tells. Features, scenario content, section order, and the name hook-stage stay.

There is no light theme. Screenshots are the dark studio only.

## Direction

- **Product.** hook-stage replays webhook scenarios against a local app and keeps the HTTP result apart from the business result.
- **Character.** exact, nocturnal, patient
- **World.** A night bench for webhook traffic: deliveries are cues on a timing strip, and the verdict splits the wire from the order book.
- **Moments.** The delivery that is on stage, and the paired run where every request can succeed while the business check fails.
- **Signature.** The stage mark, a flat vertical bar, on the wordmark and on the selected delivery.

## Signs

- Glass header: translucent fill and `backdrop-filter` on `.top` in `apps/web/src/styles.css`.
- Pure `#000000` page and `#ffffff` text, with a single muted grey instead of three text roles, in `:root`.
- Solid `#313131` borders on inputs and table rows, instead of an 8% hairline.
- Large dark shadow on `.modal`.
- Negative tracking on the 14px grip (`-0.12em`) and on the 24px wordmark, cue, and unverified heading (`-0.02em`).
- `0.04em` tracking on 12px labels, `.kicker`, and table headers.
- Weight 600 on buttons, badges, the wordmark, and result headlines.
- Zero-padded cue numbers (`01`) in `apps/web/src/Cards.tsx`.
- Reorder handle is the text glyph `::` rather than one 16px line icon.
- Floating header inset, instead of a 64px bar on the page edge.
- Scenario name field collapses beside the flow tabs around 390px.
- Target URL used `overflow-wrap: anywhere`, so the host could break mid-address.
- Delay values were not aligned as one numeric column.
- Empty captions ended with a period: "No run yet." and "This flow has no deliveries."
- Empty verification state shouted `UNVERIFIED` in `apps/web/src/Inspector.tsx`.
- Keyboard hint was a sentence with no keycaps.
- `Repeat` was a filled pill (`.badge`).
- HTTP and business status used filled pills (`.chip`).
- Modal radius was 24px.
- Skeleton looped an opacity pulse.
- Buttons transitioned `transform` for 500ms.

Not found: hue gradients, gradient text, emoji, colored glows, blobs, hype words, greeting headlines, or unverifiable claims.

## Passes

- **Spacing.** Page edges 24, panels 16, cards 12, on a 4px grid. Header is a 64px bar. Cue numbers, grips, and send times each sit in one column.
- **Color.** Graphite ramp (`#141415`, `#19191b`, `#1e1e21`, `#232325`), text `#ededed` / `#a1a1a6` / `#8f8f8f`, hairline at 8%. Sage and clay stay on pass and fail only. Primary action is off-white with dark text.
- **Icons.** The grip is one 16px line icon, muted, in a 32px box. No other icons were added.
- **Copy.** Captions drop the trailing period. The empty verification heading is "Unverified". The run sentence still says the result will be unverified. Keycaps mark Tab and Space. Product strings and scenario data are unchanged.
- **Type.** Geist and Geist Mono stay. Weights are 400 and 500. Tracking on small text is 0. Figures are tabular. Cue numbers are 1, 2, 3.
- **Layout.** Same regions in the same order: bar, scenarios, cue list, inspector, then the two result columns. The shell fills the viewport up to 1440. At 390px the name field takes its own row and the page does not scroll sideways.
- **Details.** Controls 8, nested card buttons 4 inside a 16px card with 12px padding. Status is quiet mono text. The stage mark is only on the wordmark and the selected delivery.
- **Visuals.** No generated image. The color lives in the business verdict, especially "Every request succeeded. The business outcome did not."
- **Motion.** The skeleton no longer pulses. Hover and press use `cubic-bezier(0.22, 1, 0.36, 1)` at 160ms. Press scale is 0.98. Focus rings stay a 2px off-white outline.

## Checklist

- Direction is applied across the passes.
- Spacing values used in the studio are on the 4px scale, with 2px only on the focus outline and the stage-mark radius.
- Icons, labels, and delay numbers align in columns.
- One graphite ramp, three text roles, one off-white accent. Text and status colors measured at 4.5:1 or better.
- No hue gradients, gradient text, glows, or backdrop blur.
- No emoji. One icon, 16px.
- Weights 400 and 500. No uppercase tracked labels. No italic. No negative tracking.
- No exclamation marks, no greeting headline, no new claims.
- Tabular figures. Nested card radius is 16 with 12px padding and 4px inner controls.
- Buttons share an 8px radius in the bar and inspector. In-card buttons are 4px so the radius nests.
- The first screen is the studio, edge to edge, with the cue list as the moment.
- Keyboard path still reaches the skip link, target, actions, scenarios, flows, grip, delivery, delay, and card actions. Focus is a visible 2px ring.
- Mobile at 390px does not overflow, and no text is under 11px.
