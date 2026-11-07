# Botanical envelope verification

Verified in the local browser preview at `http://127.0.0.1:4187/demo` on 2026-11-07.

- Layouts checked at 375 × 812, 390 × 844, 768 × 1024, 1024 × 768 and 1440 × 900. Document scrollWidth matched viewport width at all five sizes; botanical bounds remained within the viewport. Images decoded successfully at each size.
- The envelope's paper and specimen remain non-interactive. The accessible native wax button is the opening control, with at least a 72 px nominal size at 375 / 390 px.
- Space key opening tested at 375 px. The seal and flowers share the animated assembly; the control disables immediately. The flap reverses around the top crease, its reverse face hides the front decoration, and the insert emerges into the original reading layout.
- Original letter content and the next table entry were verified in the UI. Chinese font selection, punctuation treatment, subsequent roll / instant-print implementations, and the soundtrack implementation were not changed.
- Reduced-motion, changing the preference mid-opening, repeated activation, pagehide recovery and destruction are covered by the controller tests. The test specifically asserts that the assembly containing both flowers and seal is animated.
- TypeScript / server syntax checks and build passed. Full test suite passed: 7 tests, 0 failures.
- Both seal assets and the botanical asset retain RGBA transparency; all four corner alpha values are zero. Three visible default photographic assets total approximately 400 KB. The unused branch variant is not loaded by default.

Screenshots: `botanical-375.jpg`, `botanical-390.jpg`, `botanical-768.jpg`, `botanical-1024.jpg`, `botanical-1440.jpg`, and the opened-flap capture `botanical-open-375.jpg`.

The detailed generation prompts and asset locations are in `ASSETS.md`.
