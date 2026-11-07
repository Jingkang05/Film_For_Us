# Bilingual UI verification

Verified on 2026-11-07 with Chromium 151 headless against a running local build. Screenshots use emulated widths **375, 390, 768, 1024, and 1440 px**. The original demo response was intercepted with mixed Chinese / English test letters, roll names, titles, and captions; actual album data and image assets were not changed.

## Checks passed

- First visit defaults to Chinese; both language directions update immediately. English persists after reload; blocked localStorage falls back to in-memory switching.
- Decorative scene labels, archive counters, the brand, and the decorative camera footer stay English.
- Switching during the seal sequence preserves the same envelope node and completes the opening normally. The opened letter remains the same node with identical original content.
- Film scroll position, current viewer image, selected frames, and open preview dialogs survive switching.
- Switching during printing preserves the current phase. Three printed photos retain the same DOM nodes, transforms, counter, original mixed-language captions, and stack positions.
- Music retains the same audio node, playback position, and play/pause state. The language control does not trigger music's first-interaction playback handler.
- Developing, hanging, flipping a print, cancelling the reset dialog, image errors/retry, completed camera feedback, and bilingual replay work. Only explicitly pressing replay clears camera prints.
- Editor title, letter, photo notes, input element identity, caret range, user-content language attributes, dirty state, and the upload queue remain intact. Language switching sends no POST requests.
- Language buttons support keyboard activation, expose pressed states, preserve focus, and remain available inside native modal dialogs.
- Both languages were captured in the envelope, table, film, and camera scenes at all five requested widths. Automated geometry checks found no page overflow, header/switcher/music collisions, or hints outside the viewport.
- Chinese uses the existing Winter Poem handwriting and already calibrated original Unicode comma/full stop. English artistic camera prompts use the existing Reenie Beanie handwriting. No fonts or visual assets were replaced.
- No browser JavaScript errors occurred.

pnpm check, pnpm build, and **all 10 tests** pass, including matching translation keys/interpolation placeholders and preservation/escaping of original mixed-language values.

## Screenshots

Files use scene-width-language.jpg; complete-width-zh.jpg shows the existing replay state. JPEGs are compressed QA captures, not application assets.

- [Chinese envelope, 375 px](envelope-375-zh.jpg)
- [English envelope, 1440 px](envelope-1440-en.jpg)
- [Chinese table, 390 px](table-390-zh.jpg)
- [Chinese film, 768 px](film-768-zh.jpg)
- [Three photos, Chinese, 375 px](instant-375-zh.jpg)
- [The same three photos, English, 375 px](instant-375-en.jpg)
- [Three photos, Chinese, 1440 px](instant-1440-zh.jpg)
- [Completed camera and replay, 375 px](complete-375-zh.jpg)
- [Machine-readable results](results.json)

The browser checks used synthetic keyboard/mouse input and emulated viewports. Physical touch devices, screen-reader speech output, and independent Safari/Firefox runs were not tested.
