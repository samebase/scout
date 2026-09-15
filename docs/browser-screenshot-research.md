# Browser screenshots for presentations

Research date: 2026-09-15. Fetched `origin/main` and rebased before starting.
Baseline: `8aad831`, v213. Installed dependencies with `vp install`.

## Conclusion

Yes. We can capture PNG images directly from a live Firecrawl browser session at
chosen checkpoints. A sequence of those images can have its own order, captions,
highlights, and advance controls, independent of the recording's timing.

The original proposal was a manual **Capture screenshot** action for the selected
browser tab. The follow-up [guided walkthrough research](guided-screenshot-walkthrough.md)
now recommends agent-requested checkpoints and a final illustrated explanation.
Both use a viewport PNG at 2x resolution. These research scripts do not add the
product action or presentation editor.

## Measured results

The probe used the repository's Firecrawl 4.38.0 and Playwright 1.62.1, a new
disposable Firecrawl session, and the public Playwright screenshots documentation.
It used the development integration credential and deleted the session afterward.
No application data or production deployment was changed.

The remote browser was Chromium 152.0.7977.82. Its viewport was Scout's existing
1280 × 800 layout, with device pixel ratio 1.

| Capture                    | PNG dimensions | File size | Capture and transfer |
| -------------------------- | -------------- | --------- | -------------------- |
| Playwright viewport        | 1280 × 800     | 137 kB    | 1.06 s               |
| CDP viewport, scale 2      | 2560 × 1600    | 311 kB    | 0.93 s               |
| CDP viewport, scale 3      | 3840 × 2400    | 491 kB    | 1.57 s               |
| Playwright article element | 692 × 1039     | 109 kB    | 3.25 s               |
| Playwright full page       | 1280 × 1572    | 208 kB    | 1.64 s               |

These are single-run measurements, excluding session creation, navigation, font
loading, and local file writes. They are not latency guarantees. A separate local
Chrome trial also produced the expected 1x, 2x, and 3x image dimensions.

The 2x and 3x viewport captures preserved the measured viewport dimensions, document
width, pixel ratio, scroll position, and heading bounds. The downloaded 2x remote
PNG was visually inspected for readable text and complete viewport content.

## Capture method

Firecrawl exposes an authenticated CDP connection for each browser session, which
Scout already uses. This lets the backend capture the browser itself, without
depending on the size or quality of the embedded live-view stream.
See [Firecrawl browser sessions](https://docs.firecrawl.dev/features/browser#connecting-via-cdp).

For the successful high-resolution trial, the existing Playwright context opened a
CDP session and called `Page.captureScreenshot` with:

```ts
{
  format: "png",
  fromSurface: true,
  captureBeyondViewport: false,
  clip: { x: 0, y: 0, width: 1280, height: 800, scale: 2 },
}
```

The example captures the top of the test page. A product implementation must use
the current page's viewport and scroll coordinates. Verify scrolled pages, zoom,
and multiple tabs before shipping. The probe does not establish those cases.
See [Chrome's screenshot protocol](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureScreenshot).

Plain `page.screenshot({ type: "png" })` also works. PNG has no JPEG-style quality
setting. Playwright's `scale: "device"` follows the device pixel ratio; it does not
request 2x on a browser whose ratio is 1. Playwright supports viewport, full-page,
and element images, plus masking and screenshot-specific styles.
See [Playwright screenshot options](https://playwright.dev/docs/api/class-page#page-screenshot)
and [capture examples](https://playwright.dev/docs/screenshots).

Two trial findings affect the implementation choice:

- Setting `captureBeyondViewport: true` changed the test page's scrollbar layout.
  Setting it to `false` preserved the measured state for viewport captures.
- Overriding device pixel ratio through a separate CDP session, then calling
  Playwright's screenshot method, still produced a 1280 × 800 image in both local
  and remote trials. Use the tested CDP capture scale for an existing session.

## Fit with Scout

- `convex/scout/playwrightBrowser.ts` owns the CDP connection, selected tab, and
  1280 × 800 viewport. Its current `snapshot()` returns an accessibility text tree.
  It does not capture or save images.
- `convex/scout/browserTools.ts` limits browser-tool output to 20,000 characters.
  Base64 PNG output would be truncated. Capture bytes on the backend and return a
  file reference to the model or UI.
- `convex/workspaceStorage.ts` already provides an R2 client. Reuse its bucket and
  component, but keep image records outside workspace entries: the measured 2x PNG
  exceeds the shell's 256 KiB per-file limit. The follow-up research covers Task
  ownership and signed image delivery.
- Capture must serialize with browser operations and use the exact selected tab.
  Store image dimensions, tab identity, capture timing, and a sanitized source URL
  alongside each image. The follow-up research derives order from existing browser
  operations and proposes agent-requested captures before adding manual controls.
- Keep future highlights and captions separate from the original image. Their
  positions can be relative to the image dimensions, so resizing a slide preserves
  alignment. Each screenshot can remain visible until the presenter advances.

## Practical limits

Capture must happen while the session and desired state still exist. A closed
session's video can supply still frames at its recorded quality, but cannot supply
a fresh high-resolution rendering of a past state. Existing recordings therefore
cannot be upgraded into equivalent direct captures.

The probe verified a static public page. It did not verify authenticated target
sites, changing canvas content, video, popovers, iframe interactions, or production
storage and download. Wait for meaningful page readiness and fonts, then review
each capture. Fixed delays alone do not establish that a page is ready.

Full-page and element capture can scroll or change scrollbar layout. Viewport
capture is the smaller first step. The remote test browser also rendered fonts
differently from the local Mac, so target-site font fidelity needs visual review.
Higher resolution does not replace missing fonts or add detail to low-resolution
source images. Visible credentials and personal data need review before sharing.

## Reproduce

From the repository root, with a matching Playwright Chromium installed:

```sh
pnpm --filter samebase-scout exec node scripts/research-browser-screenshots.ts local
```

An optional final argument selects an existing Chrome executable:

```sh
pnpm --filter samebase-scout exec node scripts/research-browser-screenshots.ts local "/path/to/chrome"
```

With `FIRECRAWL_API_KEY` supplied in the process environment:

```sh
pnpm --filter samebase-scout exec node scripts/research-browser-screenshots.ts firecrawl
```

The remote probe creates a session with a 180-second lifetime and closes it in
`finally`. It uses provider credits. It opens only the public test page, saves PNGs
and `report.json` to a printed temporary directory, and keeps credentials out of
the report. The report includes measurements before and after captures.
