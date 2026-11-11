# Phase 1 — Persistent viewer likes

## Scope and cause

`mountDarkroom` previously initialized every visit with `fresh()`, including an empty `selected` list. Both liking controls already update that list through `toggleMarked`, and the existing developing queue is derived from it. Nothing saved the selection across visits.

This change restores only `selected`. The envelope, current roll, browsing position, developing queue and hung prints start fresh. The explicit “Start over” action also keeps likes while restarting the experience; its existing confirmation text now describes that behavior. The existing persisted `pageshow` handler still reloads the viewer after a back-forward-cache restore, which restarts the envelope and reloads likes normally.

## Persistence

- Key: `roll-for-us:viewer-likes:v1:album:<encoded stable album.id>`.
- Draft previews use a separate `preview:` namespace so draft-only photos cannot replace a viewer's published selections.
- Value: `{ version: 1, albumId, likedPhotoIds }` only. No image data, title, URL slug, navigation state, personal data or new dependencies.
- The API's immutable album ID is unchanged when its custom URL suffix changes. Photos use their existing stable IDs, not positions.
- Initialization validates the schema and album ID, deduplicates saved IDs and filters IDs absent from the current album. Stale IDs are removed from storage on the next selection change.
- Every like/unlike writes synchronously before rendering. Blocked reads, malformed data and failed writes are caught; the current visit continues with in-memory state.
- The final collection still uses the existing selection and developing flow. Once developing starts, the existing viewer locks selection changes until restarting.

## Changed files for this phase

- `src/viewer-likes.ts`: versioned persistence and safe restoration.
- `src/darkroom.ts`: restore likes at initialization, save in the shared toggle function, preserve likes on explicit restart.
- `src/ui-translations.ts`: update the existing restart explanation in Chinese and English.
- `test/viewer-likes.test.mjs`: persistence, schema, deletion, reorder, isolation, slug-independent ID, rapid updates and storage failures.
- This document.

The working tree already contained unrelated changes from earlier tasks. This phase preserves them. No production deployment, production settings, editor, upload API or Blob changes are part of this phase.

## Automated verification

TypeScript build and type checking pass. All 22 tests pass, including 8 new persistence tests and the existing envelope animation lifecycle, album/API, owner, translation and URL-suffix tests.

Local browser verification used the demo on an isolated localhost origin: two photos were liked, refresh returned to the sealed envelope, both heart states were restored, and unliking the first left only `rain-2` in the developed final collection. Explicit restart returned to the envelope; a new tab on another URL for the same album restored the remaining one-photo selection. Browser Back also returned to the envelope. No production album content or viewer preferences were touched.

## iPhone Safari checklist

Use a normal Safari tab on the same origin each time:

- Open an album, confirm the sealed envelope and original opening animation, then like two photos.
- Refresh: the envelope must restart; reopen the rolls and confirm both hearts and the collection count.
- Close the tab, terminate Safari and reopen the same album: repeat the check.
- Unlike one photo and like another; develop the collection and confirm only the current selections appear.
- Choose “Start over”: reopen the envelope and confirm likes remain, but browsing and developing progress restart.
- Navigate away and use Safari Back/Forward: returning must restart at the envelope with likes intact.
- Visit a second album and confirm its likes are independent.
- Change the first album's custom suffix, open the new URL on the same origin and confirm likes remain.
- Reorder photos, then delete a liked photo and republish; reload and confirm likes stay on the same remaining photo IDs and the deleted image is absent.
- Check Private Browsing and any storage restrictions: interactions and animations must continue even if persistence is unavailable.

## Limits

Preferences belong to this browser profile and origin, not an account. They do not synchronize across devices, browsers, tabs already open, or different domains. Clearing site data removes them. Private Browsing or storage eviction may discard them, and blocked/full storage falls back to the current visit only. Old and new custom suffixes on the same domain share preferences. Switching domains does not transfer browser storage. Full iPhone Safari termination and real iOS back-forward-cache behavior require testing on an iPhone.
