# HEIC/HEIF editor uploads

## Decision and pipeline

The editor previously sent original bytes through an authenticated Blob upload target (private original, then server processing), or the local server body route. The server verifies signatures, still-image format, 20 MB and 50 MP limits, corrects orientation, and creates 1800px quality-88 / 480px quality-80 WebP variants using Sharp. None of those checks, album IDs, existing URLs, or viewer code changed.

Sharp 0.35.5's default prebuilt codecs are not a reliable HEVC decoder. The actual installed prebuilt Sharp rejects the real HEIC fixture in automated testing. Vercel uses the pinned normal prebuilt dependency rather than a custom libvips installation; decoding inside the deployed Linux function was not separately probed. We therefore avoid depending on server-side HEIC support entirely.

Compared libraries:

- heic2any: familiar browser converter, older libheif lineage and worker/CSP integration would require additional review.
- heic-to 1.6.7: selected for its updated libheif decoder and explicit CSP build. Pinned exactly, no runtime CDN or external conversion request. Its CSP build is approximately 3.1 MiB uncompressed and loaded only for HEIF content, only from the editor. Ordinary viewer and JPEG/PNG/WebP users do not download it.

Sources: https://github.com/hoppergee/heic-to, https://github.com/alexcorvi/heic2any, https://sharp.pixelplumbing.com/install/, https://sharp.pixelplumbing.com/api-output/#heif.

The upload preparation layer checks ISO-BMFF ftyp box bounds and major/compatible HEIF brands, independent of filename/MIME. A decoder must then successfully parse and decode actual content. Invalid ftyp-shaped files cannot bypass the decoder or server validation. Existing JPEG/PNG/WebP signatures take precedence over misleading extensions. Each HEIF converts locally into JPEG quality 0.92, with .jpg filename and image/jpeg File type; output signature and size are checked before any upload target is requested. Original HEIC bytes never go to a conversion service or Blob through this workflow. Blob transport remains application/octet-stream as required by the existing signed upload token; the JPEG File's own type is image/jpeg.

The editor's existing serial upload queue also serializes conversion. A second shared conversion queue prevents concurrent calls from decoding large images together. A translated processing state and persistent live announcement appear during conversion; decoder/unsupported/size errors use the existing failed-upload/retry workflow. Replacement uses the same preparation step without changing Photo IDs.

HEIC container rotation is handled by libheif's decoded pixels; JPEG canvas output avoids carrying a second orientation tag. Portrait output dimensions are tested. Actual iPhone rotation/mirror/HDR fidelity still needs the device checks below. Multi-image HEIF uses the primary still image, not a Live Photo movie or burst sequence. JPEG output is an SDR browser canvas rendering; HDR/wide-gamut/depth metadata preservation is not promised.

## Packaging and security

`build-heic-decoder.mjs` copies the pinned CSP ES module and LGPL license into generated public/ui assets. A small documented build transformation guards the worker's RGBA allocation at 50 MP, matching the server limit. The build fails if the expected upstream allocation expression changes. This guard bounds the output allocation, not all native decoder/internal memory. The script is also the reproducible source modification record. The upstream dependency remains unmodified in node_modules.

CSP explicitly permits self-hosted and blob workers; unsafe-eval is not enabled. The CSP decoder uses a blob worker and does not fetch remote codecs. Server signature/decode/size checks remain authoritative and still reject direct original HEIC uploads. The decoder license is served as text alongside the module, with upstream source at https://github.com/hoppergee/heic-to (package source/version also available through npm).

No authentication, storage schema, publication lifecycle, media URLs, viewer rendering or public album content changed. Pre-existing unrelated working-tree styling changes are excluded.

## Verification

- Build and type/syntax checks pass.
- Full test command passes (48 runner entries).
- Actual CSP libheif worker decodes the public libheif example to JPEG (1280×854), and a synthetic portrait HEIC at 6000×8000 (48 MP). The same fixtures fail default Sharp HEIC decoding.
- Real corrupted HEIC decoding rejects; wrapper tests verify spoofed extensions, malformed/truncated ftyp, compatible brands, MIME-less and inconsistent MIME HEIF, JPEG output type/name/signature, serial concurrent requests, recovery after failure, and unchanged JPEG/PNG/WebP identity.
- In-app browser smoke under a restrictive CSP: PASS, sample.jpg image/jpeg 1280×854, no console errors. This is not claimed as a named desktop Safari/Chrome or physical iPhone test.
- Existing authenticated upload/optimization/Blob-compatible storage regression tests pass. No production albums or private images used in tests.

Run `pnpm build`, `pnpm check`, `pnpm test`. Run `node scripts/check-heic-browser.mjs` for an isolated localhost decoder check with the public fixture. This page has no album or Blob access.

## Pending real-device/browser acceptance checklist

Production is intentionally not deployed in this change. Before release, test the feature branch/local editor in current desktop Safari and Chrome, plus a physical iPhone Safari:

1. Select a real iPhone HEIC through Photos and through Files. Confirm processing state, successful JPEG conversion/upload, correct thumbnail and full image.
2. Repeat landscape, portrait, rotated, mirrored, HDR, 12 MP and 48 MP originals. Check orientation, skin tones, highlights, and quality against Photos.
3. Use a genuine .heif file, missing MIME and application/octet-stream files. Check successful content-based handling. Try a JPEG with a .heic name: it should remain a normal image upload.
4. Queue several HEICs alongside JPEG/PNG/WebP; confirm one conversion at a time, responsive controls, stable ordering, save/reload and no Safari tab reload from memory pressure.
5. Try corrupt/truncated HEIC, renamed non-image, >20 MB input, >50 MP image and oversized converted JPEG. Confirm a useful failure, no publishable placeholder, and successful subsequent normal upload/retry.
6. Test replacement, moving between rolls, saving a draft, private preview and publishing a disposable sample album. Confirm stable Photo IDs and prior public snapshot isolation.
7. Test slow/offline decoder-module loading and interrupted uploads; restore connectivity and retry.
8. Check VoiceOver announces conversion/failure and keyboard focus stays in the editor.

Standard camera-original iPhone fixtures and physical iPhone Safari are not available in this session. Their compatibility, color/orientation edge cases and large-image phone memory behavior remain unverified. Do not equate the synthetic 48 MP test with an iPhone device-memory test. No paid service is required.
