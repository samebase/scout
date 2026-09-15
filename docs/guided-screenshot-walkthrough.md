# Guided product walkthroughs

Research date: September 15, 2026. Baseline: `bdf25f2`, v214.
This continues the Codex task "Research manual screenshots". Three independent
reviews covered storage, capture association, and the finished experience.

Implemented and tested on the development deployment. An ordinary Score Four
review produced six saved PNGs and a four-section walkthrough. The screenshots
and report survived browser closure. Provider history errors interrupted the
trial; the task finished after a manual follow-up. Details are below.

## Implemented first version

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

The Task cap is 20 captures, with an 8 MiB limit per PNG. Scout should capture the
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
  Evidence capture requires the exact target and rejects a missing or changed
  page instead of using its ordinary fallback selection.
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

The `agentsApiScreenshots` table stores:

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

Keep task-specific captures out of shared Site workspaces. For the public
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

The capture tool returns an ID, the agent's note, and observed page metadata.
Scout continues its normal task and writes explanations from its browser
observations. PNG bytes stay in R2 and are delivered to the viewer through signed
URLs. There is no image-input round trip or separate vision-analysis pass. This
means captions reflect Scout's observations, rather than an independent visual
verification of the saved image. Product trials must check the images themselves.

In Agents, add Walkthrough beside Request check, Site research, and Chat in the
existing flat Task tree. In the public review, show the explanation with a large
uncropped screenshot, Previous/Next controls, a counter, and Expand. Keep Chat and
Replay reachable. Load the displayed original on demand, then preload the next
screenshot at low priority. Reuse unexpired signed URLs within the open Task and
share in-flight URL requests when navigation catches up with a preload. Do not
decode 20 full images at once. Replay selection may open the source browser session, but should
not claim an exact matching video time.

Defer annotations, drag-to-reorder editing, narration, transitions, thumbnails,
exports, and shared screenshot libraries. The images and captions could later
produce a slideshow video without aligning Firecrawl's recording clock, but that
is not required to make the review readable.

## Product trial

The homepage submitted this ordinary prompt to Conrad, without screenshot instructions:

> Try https://score-four.pfp.workers.dev/. Check local play, undo, and starting a new game. Tell me what works and any problems you observe.

The first attempt failed on an OpenAI history request before opening a browser.
A manual continuation then received a provider conflict when submitting a tool
result. It supplies no evidence for screenshot capture.

The fresh second task is available in development at
`/review?thread=s573q12n8qh2npsvjxxwq5nbg98eetb8&view=walkthrough` and its admin
inspector at `/agents?session=s573q12n8qh2npsvjxxwq5nbg98eetb8&step=walkthrough`.
Scout read its research, tested the game, and saved six 2560 × 1600 PNGs:

1. Homepage with local play and invitation controls.
2. Empty local board, Maple to move, Undo disabled.
3. First move placed on A1, Walnut to move, Undo enabled.
4. Undo restored the empty board and Maple's turn.
5. New game confirmation dialog.
6. Confirmed reset with an empty board and Undo disabled.

Scout called `save_walkthrough` with four sections covering local play, move/Undo,
reset confirmation, and the unavailable 3D view. Those sections reference seven
images because the empty-board capture also illustrates the 3D limitation.
All six tool results contained only `kind`, `captureId`, `note`, and `metadata`.
Capture start-to-finish measurements were 389–792 ms, excluding R2 upload.

A second OpenAI history 404 interrupted wrap-up after the walkthrough was saved.
Browser cleanup closed the session. A manual follow-up asking for the final
summary completed the task, which is now idle. Later read-only requests for both
failed history reads returned 200. The exact cause of those transient errors is
unresolved; this was not an uninterrupted end-to-end run.

Investigation also found a separate cursor bug: failed tool items were not treated
as terminal and could hold the local history cursor behind completed work. That
condition now advances the cursor and has a regression test. It does not explain
or fix the provider 404/conflict responses. No retry framework was added.

The saved images were checked in the public viewer against the captions. An
unauthenticated client could read this public report and fetch its signed image
URL as `200 image/png` after browser closure. Automated checks cover private/public
authorization, foreign capture rejection, upload failure without replaying an
interaction, task switching, and signed URL refresh. Browser checks cover the
desktop and mobile walkthrough, Expand, Previous/Next, Replay, and the admin
Workspace button while viewing Walkthrough.

The UI now puts explanations beside the uncropped image in a wide pane and stacks
them in a narrow pane. Expanded screenshots fit the viewport. Finished public
reviews start on Walkthrough, with Chat and Replay available and a compact
follow-up link. Running or interrupted tasks keep the composer and Stop controls.

Three subagents reviewed and implemented capture association, storage/access, and
the shared viewer. The remaining empirical work is a short form or calculator
review and a multi-page product review. OAuth, human handoff, zoom, and changing
canvas content have not been validated by these screenshot trials.
