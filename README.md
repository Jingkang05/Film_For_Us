# Film for us

A mobile-first film album with lightweight Chinese / English UI prompts. The demo opens with a letter and leads to a table with two 35 mm rolls and an instant camera.

## Run locally

Use Node.js 24 and pnpm.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open [the demo](http://127.0.0.1:4173/demo). To start your own album, choose **Upload photos**. On the first visit to the [local album editor](http://127.0.0.1:4173/manage#upload), set an owner password of at least 12 characters. For a hosted instance, configure `OWNER_PASSWORD` on the server before signing in.

The owner album starts with an empty draft. Write the opening letter in any language, choose a roll, and select or drop JPEG, PNG, or WebP files into the upload area. Review the list and select **Upload**. Add a date to each photo before you publish. Notes are optional. Later publications reuse the same share link.

The local server binds to loopback by default. `ROLL_DATA_DIR` sets the location of the SQLite database, which contains the draft, original uploads, display images, and the current published snapshot. It defaults to `.data`. The share link grants access to anyone who holds it.

## Bilingual UI prompts

The upper-right **中 / EN** buttons switch interaction prompts, controls, tooltips, loading/error feedback, and editor UI. First visits use Chinese; `localStorage["roll-for-us:ui-language"]` remembers the choice. If storage is unavailable, switching still works for the visit.

- `src/ui-translations.ts` contains the typed, matching dictionaries and known application error messages. No translation service, language routes, or i18n dependency is used.
- `src/ui-language.ts` updates only explicit `data-ui` text leaves and marked attributes. It never calls scene renderers, updates input values, or replaces scene, photo, or audio nodes. The same switcher moves into open native dialogs to remain keyboard-accessible.
- Decorative English scene/archive labels, the brand, and the decorative instant-camera footer stay English. User letters, titles, roll names, notes, dates, and images are left exactly as authored.
- Chinese UI reuses **寄给冬天的情诗** and the existing Unicode-preserving punctuation font calibration described in [TYPOGRAPHY.md](TYPOGRAPHY.md). English artistic prompts use the existing Reenie Beanie handwriting; decorative type stays unchanged.

Browser verification and screenshots are recorded in [previews/bilingual-ui/README.md](previews/bilingual-ui/README.md).

## Wax-sealed envelope

Press the burgundy floral wax seal, or focus it and press Enter / Space. The paper and dried sprig do not open the envelope. A 2.8-second sequence releases the seal and its botanical specimen together, turns the two-sided cotton-paper flap around its top crease, draws the original letter out from behind the pocket, and carries it into the existing reading layout. The seal and stems remain attached to the flap as it turns; their cast shadows stay on the paper. Music uses the existing control; no additional sound effects are added. “For you” is removed from the envelope.

- `src/envelope-config.ts`: set `motif` to `"rose"` (default) or `"branch"` to select one of the two photographic wax reliefs. Also contains asset paths, stage durations, and easing. Interaction copy lives in `src/ui-translations.ts`.
- `src/envelope.ts`: layered paper construction, independent photographic wax and botanical images, and two silhouette masks for the directional stem / flower / leaf shadows. `src/envelope-motion.ts` owns `sealed → sealReleasing → flapOpening → letterEmerging → transitioning`; the reading transition then reaches `completed`.
- `public/envelope.css`: cotton colors (`--cotton-light`, `--cotton`, `--cotton-shade`, `--fold-shade`), wax size (`--seal-size`), responsive extraction distance (`--letter-lift`), photographic fibre texture, edge shading, botanical placement, and focus / hover treatment. The four optimized WebP assets are in `public/assets/envelope-*.webp`; their generation prompts and provenance are recorded in `previews/envelope/ASSETS.md`.
- `src/darkroom.ts`: preserves album text and existing scenes, and matches the emerging paper's measured position to the reading scene. Repeated activation is locked; pending animations are cancelled on scene changes and page exit. Reduced motion keeps 120 ms of seal feedback and opens the letter without spatial movement.

After configuration changes, run `pnpm build` and reload. Every new visit or reload starts at the sealed envelope. Reading progress stays in memory for the current visit; old saved scene progress is ignored. Browser back/forward-cache restores also start a new visit. The controller tests cover repeated activation, sequencing, page exit, cancellation, and changing reduced-motion preferences.

## Instant prints

Open the envelope, choose **Enter the darkroom**, then select the brown camera resting on the table. The view moves in as the camera rises to face you. Press the shutter to send the next photo up through the top slot. The previous print slides onto the table as the next one comes out. The speaker button toggles shutter sound. Select any visible print to read the full caption. **Replay the Moments** clears the table after the last print.

- To use your own photos, set **Destination roll** to the third roll in the album editor. Upload the images, use the up and down buttons to arrange them, and use **Note on the back** to add any captions. Choose **Preview draft** to try the sequence locally or **Publish** to update your share link.
- To replace the demo photos, add your WebP files to `public/samples` and edit the `home` list in `server/demo.mjs`. For example, `sample("my-photo", "The caption.")` loads `public/samples/my-photo.webp`. If you keep a sample’s existing name and it specifies a separate thumbnail, replace both files. The list order sets the print order and its length sets the counter total. Restart `pnpm dev` after editing `server/demo.mjs`.
- Edit `instantCopy` in `src/polaroid-config.ts` to change the instructions and other scene copy. The `instantMotion` values are in milliseconds. Lower them together for a faster print sequence or raise them to slow it down. Adjust `ejection` to tune how long the print takes to feed through the slot and `development` to tune how quickly the image appears. After editing the configuration, run `pnpm build` and reload the page.
- `src/polaroid.ts` controls the shutter, ejection, development, and stack. `public/polaroid.css` controls the composition, material treatments, and responsive breakpoints.

## Deploy on Vercel

Use Node.js 24 and connect a **private** Vercel Blob store to the project. Configure `APP_ORIGIN` with the production HTTPS origin, without a trailing slash. Vercel serves the compiled files in `public` and routes the API to the Node.js function in `api`.

For a new album, configure an `OWNER_PASSWORD` of at least 12 characters. To bring over a local SQLite album, run the migration before serving traffic, with the new store's `BLOB_READ_WRITE_TOKEN` available in your shell environment.

```sh
node scripts/migrate-to-vercel.mjs
```

You can pass a SQLite path as the first argument. The migration keeps the share ID, draft, published version, original photos, display images, and any password set through the local editor. Sign in again on the production domain. The local and hosted albums are separate after the import.

## Verify

```sh
pnpm check
pnpm test
```

The integration test uses an isolated database and 18 sample uploads. It covers EXIF rotation, size variants, duplicate retries, stale revisions, private media access, failed publication, restart persistence, and replacement of the public snapshot. Guest and draft-preview reading progress is held only in memory. Language and shutter-sound preferences remain saved.

## Visual reference

The four scene compositions come from the supplied video at 00:00 (envelope), 00:04 (overhead roll table), 00:08 (film close-up), and 02:00 (printing tray and drying line). The live objects use HTML and CSS, with hand-marked selections, paper grain, and a red safelight. The phone layout repositions the same objects around one interaction at a time.

The reference video does not identify its fonts. The app matches the English lettering with [Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) for titles, [Courier Prime](https://fonts.google.com/specimen/Courier+Prime) for the letter and scene numbers, and [Reenie Beanie](https://fonts.google.com/specimen/Reenie+Beanie) for handwritten prompts. Chinese text, including new user input, uses the owner-supplied **寄给冬天的情诗**. Its missing CJK characters fall back to **清松手写体 7p** under SIL OFL 1.1. The fonts are served locally; Chinese comma and period placement is optically centered without changing the stored text. See [TYPOGRAPHY.md](TYPOGRAPHY.md) for resources, licensing limitations, role tokens, glyph coverage and build instructions. The owner-supplied font's web embedding license has not been verified; the other fonts' SIL Open Font License notices are in `public/assets`.

The original six demo photos in `public/samples`, including `home-1.webp` and `home-2.webp`, are cropped from a contact sheet generated with the built-in ImageGen tool. The prompt follows.

> Create one edge-to-edge 3-column by 2-row contact sheet of six DIFFERENT candid 35mm color travel snapshots, 3:2 canvas, exactly equal-size square tiles touching at straight grid boundaries with no gutter, no margins, no text, no frames, no overlapping content. These are example photos for a personal darkroom album. Top row, left to right: a tiny figure under a light umbrella beside an old wet street and lush green shop fronts; sunlight coming through a café window onto two cups and an empty chair; a cyclist on a coastal road above a quiet blue sea. Bottom row left to right: distant person at the edge of a breaking wave on a foggy beach; a red train crossing a steel bridge seen from a riverbank at dusk; the lights of a quiet apartment building seen from across a leafy street at night. Each frame is intentionally composed with depth and its own focal point. Nostalgic casual film photography with restrained color, slight grain and warm highlights, no borders or date stamps, authentic and plausible, no identifiable faces.

Both views of the brown camera were generated together from the supplied references with the built-in ImageGen tool. The crops are stored as `public/assets/instax-mini-evo-front.webp` and `public/assets/instax-mini-evo-table.webp`. The prompt follows.

> Make a transparent two-view product reference sheet for ONE identical brown Fujifilm instax mini Evo camera. Landscape canvas split into two equal side-by-side panels without a visible dividing line. One complete camera per panel, centered, same portrait proportions and scale, both on fully transparent alpha, isolated with no floor, no cast shadow and no background, no captions, no paper anywhere. The supplied Fujifilm frontal product photo defines front layout, orientation, and proportions: faithfully match it, including vertical brushed silver controls strip on image left, rectangular flash over round silver shutter and small mirror, large round black lens right of center, brown pebbled leatherette, small copper switch lower right and small instax mini Evo badge upper right. The supplied earlier render is a MATERIAL reference only. LEFT panel is the standing camera for the website shutter scene: perfectly straight frontal angle, yaw precisely ZERO, roll precisely ZERO, sides parallel, no left or right side visible whatsoever. The lens is round and aimed squarely at the viewer. Camera is viewed just a few degrees above eye level, only enough to show a slim upper strip of brushed silver and a single readable dark horizontal recessed film ejection slot centered over the body and roughly 60% of the body width. The slot is absolutely horizontal, from left to right. RIGHT panel is the EXACT SAME CAMERA lying flat on its back on an invisible tabletop, its front face and lens looking up at the ceiling. The viewer is directly overhead, with a slight tilt of about ten degrees toward the lower end of the camera body, so the thin lower silver edge and depth are visible, and the top film slot is hidden at this angle. Keep the right panel body upright within its own image coordinates, without rotation or slant in the image plane. Both views have the SAME recognizable front face, matching proportions, matched brown leather, matched warm subdued tungsten lighting, the same small product marks, and no side yaw in either shot. Product photography realism. Put clear transparent margins around each isolated object. No other props, no sample Polaroid, no watermark.

The six additional instant prints in `public/samples/home-3.webp` through `home-8.webp` come from a second built-in ImageGen contact sheet. Its prompt follows.

> One edge-to-edge 3-column by 2-row photographic contact sheet for an interactive film album called After Dark. Exactly equal-size square tiles, 3:2 canvas, straight grid boundaries, no gutters, borders, captions or watermarks. Six different authentic 35mm color film snapshots united by the course of a single evening, restrained warm amber highlights and deep natural shadows, subtle grain, analog halation, editorial and candid, strong readable focal point centered in each tile for a portrait crop. Top row left to right: a small amber-lit diner window seen across a blue-hour wet street with the reflection in the foreground, a hand holding a cup beside a fogged train window with blurred night lights outside, two distant silhouettes crossing a rain-damp street under one streetlamp. Bottom row left to right: a table for two with low candlelight and a white tablecloth after dinner, a quiet flight of old residential stairs with a shaft of tungsten light, an open window framed by gauze curtains looking out on distant pinpoints of city lights. Photorealistic travel and personal documentary photography, no recognizable faces, no lettering, no collage inside any tile.
