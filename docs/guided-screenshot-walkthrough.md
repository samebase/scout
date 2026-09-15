# Guided product walkthroughs

Research date: September 15, 2026. Baseline: `bdf25f2`, v214.
This continues the Codex task "Research manual screenshots". Three independent
reviews covered storage, capture association, and the finished experience.

The capture probes work in a real Firecrawl browser. Screenshot storage, agent
capture requests, and the walkthrough UI are **proposed, not implemented**.

## Recommended first version

Give each Task an agent-created **Walkthrough**: a short explanation illustrated
by selected screenshots. A visitor can understand what the product does, what
Scout tried, and what it found without watching a long recording. Chat and Replay
remain available.

Use the existing private R2 bucket and component. Keep screenshot records attached
to the Task, outside the Bash filesystem. Capture selected checkpoints at
2560 × 1600 and keep the original PNGs. At the end, the same Scout chooses the
captures and writes their explanations. This needs no manager agent, new bucket,
or presentation editor.

## What we verified

The [original probe](browser-screenshot-research.md) established 2x viewport PNG
capture on a static public page. The follow-up probe used one new disposable
Firecrawl session and exercised transitions:

| Capture | Change before capture                                       | PNG bytes | Capture and transfer |
| ------- | ----------------------------------------------------------- | --------: | -------------------: |
| 01      | Open Playwright's screenshot guide                          |   311,051 |             1,187 ms |
| 02      | Scroll 600 CSS pixels through Firecrawl `browserExecute`    |   277,081 |               943 ms |
| 03      | Open `example.com` as a popup                               |    44,737 |               300 ms |
| 04      | Navigate that popup to Playwright's pages guide             |   320,773 |             1,892 ms |
| 05      | Disconnect, reconnect, select original tab by CDP target ID |   277,081 |             1,247 ms |

Every image was 2560 × 1600. Before/after checks found no change to URL, title,
document loader, viewport, scroll, or document dimensions during each capture.
The popup retained its target ID across navigation. The first tab retained its
ID and scroll after reconnect. Looking up its ID after closing it failed instead
of selecting the other tab. The scrolled and navigated PNGs were visually inspected.
The remote session was deleted in `finally`.

These are single-run measurements, not guarantees. The probe exercised Firecrawl
and CDP directly, not Scout's production capture path. It did not test OAuth,
human handoff, zoom, animated canvas, image delivery from R2, or agent-authored
explanations. Stable URL and geometry do not prove that a changing page stopped
updating its pixels.

Reproduce with `FIRECRAWL_API_KEY` in the process environment:

```sh
pnpm --filter samebase-scout exec node scripts/research-screenshot-transitions.ts
```

The script prints a temporary directory containing PNGs and `report.json`. It
creates a browser with a 180-second lifetime and consumes provider credits.

## Capture meaningful moments

Add one nullable `captureNote` argument to `browser_execute`. The agent sets it
when the resulting state is useful evidence, with a short description of what it
is trying to show. One capture per call keeps its relationship to the action
clear. A capture without an interaction can use `browserState(page)`.

Capture after reconciling the target returned by `browserState`, before the ARIA
snapshot, while the existing browser operation remains exclusive. Pin that exact
Page for both metadata and image capture. Never substitute another tab when the
requested one disappears. After a popup or handoff, inspect and explicitly select
the intended tab first.

Use `Page.captureScreenshot` with `captureBeyondViewport: false`, scale 2, and the
current viewport's page coordinates. The successful scroll probe obtained those
coordinates from `Page.getLayoutMetrics().cssVisualViewport`. This avoids changing
the viewport just to request a larger image. CDP returns image data without a
render timestamp, so record the capture's start and completion times rather than
claiming an exact frame time. See the [Chrome protocol definition](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Page.pdl).

Start with a small Task cap, provisionally 20 captures. Scout should capture the
starting context, meaningful results, observed problems, and the final state.
The normal target is fewer images. Do not capture every wait, inspection, password
fill, or verification code. Multiple interactions in one script produce only its
final image; split the call when an intermediate state matters.

Return capture success or failure separately from the action outcome. A failed
upload must not tell Scout to repeat an action that already succeeded.

Current implementation touchpoints:

- [Browser execution](../apps/scout/convex/scout/browserTools.ts) already records
  operations, reconciles selected target IDs, and rejects overlapping operations
  within one harness.
- [CDP browser](../apps/scout/convex/scout/playwrightBrowser.ts) owns Page handles.
  Its existing fallback selection is unsuitable for evidence capture; add a
  method that requires the exact target.
- [Runtime tool wiring](../apps/scout/convex/agentsApi/tools.ts) connects operation
  callbacks to persistence.

## Storage and metadata

The [workspace limits](../apps/scout/convex/workspaceModel.ts) are 256 KiB per file
and 5 MiB total. Four of the five trial PNGs exceed the per-file limit. The
[shell](../apps/scout/convex/scout/workspaceShell.ts) hydrates persisted files on
each call. Raising those limits would make ordinary Bash calls load screenshots
that they do not need.

Reuse the [R2 client](../apps/scout/convex/workspaceStorage.ts) beneath workspace
storage, with a distinct key prefix:

```text
deployments/<deployment>/tasks/<agentsApiSessionId>/screenshots/<captureId>.png
```

The existing development and production buckets stay separate. A key prefix groups
files; application authorization controls access. R2 stores bytes, while Convex
stores the capture's meaning and ownership. The R2 component's synchronized file
metadata is not a second copy of the Task model.

Prefer one small `agentsApiScreenshots` table:

| Fields                                                           | Purpose                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `sessionId`, `operationId`                                       | Index captures by Task and link to the existing browser operation          |
| `note`                                                           | Agent-authored intent and reason for requesting the checkpoint             |
| `state.kind`                                                     | `pending`, `ready`, or `failed`; an interrupted upload remains inspectable |
| Ready state: `key`, `width`, `height`                            | Original image reference and measured PNG dimensions                       |
| Ready state: `tabId`, `url`, `title`                             | Observed source from the captured target                                   |
| Ready state: `startedAtMs`, `completedAtMs`, viewport and scroll | Capture timing and geometry                                                |
| Failed state: `message`                                          | Visible failure, without changing the browser action's outcome             |

Use required variant-specific fields. Reserve the capture row before upload, one
per operation. Derive provider session, tool call, and browser history through
`operationId`; do not copy all those IDs into the capture record.

Order the bounded capture list by the existing browser-session sequence and
operation sequence, with the capture ID as a stable tie-breaker. There is currently
one Chat per Task and one active browser at a time. No new order counter is needed.
The explicit Task index is useful: finding 20 screenshots should not scan the
maximum 50 browser sessions and 500 operations per session.

Do not add a new Task table or rename existing backend records for this feature.
The UI's Task is currently the `agentsApiSessions` record with its associated
`scoutChats` product metadata. Screenshot rows fit under that existing ownership.

Serve images directly from R2 through short-lived signed URLs. Authorize a
screenshot ID, then sign its stored key. Never accept an arbitrary key from the
viewer or persist signed URLs as identity. The installed R2 component already
provides upload, signing, and deletion. [R2 component](https://github.com/get-convex/r2#readme),
[Cloudflare signed URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

Keep task-specific captures out of shared Site workspaces. For the proposed public
Walkthrough, use the Task's existing public/private visibility and owner/admin
controls. This follows today's public Chat and Replay contract. It does not make
account screens safe to capture: URL/text sanitation cannot remove secrets from
pixels. Deliberate safe checkpoints matter. A separate publish/approval policy
would be another product decision, not an implicit storage feature.

Keep originals after browser closure and Task completion. Removing a capture must
also remove its walkthrough references and request deletion of its R2 object.
Component deletion schedules physical deletion; do not claim immediate revocation
of a previously issued signed URL. Follow the existing manual repair approach for
interrupted uploads; no new retry queue or bucket expiry policy.

## What happens at the end

The final result should contain a summary and ordered sections with a heading,
explanation, and existing capture IDs. For example, a section can show a completed
signup, another the product's main action, and another its resulting output or a
reproducible problem. This presentation order can omit repetitive setup while the
underlying capture order remains unchanged.

Have the same Scout call `save_walkthrough` before finishing its review. Validate
that every referenced capture is ready and belongs to this Task. Store one current
walkthrough on the existing Task record. Follow-up Chat instructions can replace
it. We do not need another autonomous agent, a slide table, or an owner-editing UI
for the first trial.

The agent must receive actual image content to assess whether a capture supports
its explanation. The installed OpenAI SDK 7.15.0 accepts `input_text` and
`input_image` content in an Agents tool result. Our
[runtime](../apps/scout/convex/agentsApi/runtime.ts) currently stringifies every
result, and [call persistence](../apps/scout/convex/agentsApi/model.ts) only stores
a string. Preserve a capture reference in the stored result and resolve it to
signed image content when submitting the provider result. Passing an image URL
inside a JSON string does not give the model image input. This provider path still
needs a real Scout test.

In Agents, add Walkthrough beside Request check, Site research, and Chat in the
existing flat Task tree. In the public review, show the explanation with a large
uncropped screenshot, Previous/Next controls, a counter, and Expand. Keep Chat and
Replay reachable. Load the displayed original on demand; do not decode 20 full
images at once. Replay selection may open the source browser session, but should
not claim an exact matching video time.

Defer annotations, drag-to-reorder editing, narration, transitions, thumbnails,
exports, and shared screenshot libraries. The images and captions could later
produce a slideshow video without aligning Firecrawl's recording clock, but that
is not required to make the review readable.

## Next implementation and test

Implement capture-to-R2, image tool results, and the simple walkthrough renderer
together. Then run an ordinary review prompt through Scout on a site that needs
no human handoff. Verify the completed explanation against its actual screenshots,
not just successful tool calls.

Test a short form or calculator flow and a multi-page product flow. Check capture
selection, observed captions, persisted order after reconnect, private/public
access, survival after browser closure, signed URL refresh, and an upload failure
that does not repeat the interaction. Change capture defaults only if these trials
show that Scout misses important states or captures too much.

The subagent reviews supplied the storage, tab-association, and walkthrough
recommendations. Their proposed editor controls, duplicate provenance IDs, and
new capture-order counter were deferred or removed from this MVP. All reviewers
were read-only and used the primary checkout. Research and probes are on
`nicu-guided-screenshot-research`; no product code or deployment changed.
