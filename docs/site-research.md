# Agent-selected site preparation

After request approval, the review agent interprets the natural-language request
and identifies the main product site with `set_review_site`. The tool attaches the
task to shared public research and waits through the existing durable task runtime.
Once preparation completes, the agent reads its private brief and continues the
requested work. The runtime handles waiting without repeated LLM polling or a
second Scout. There is no startup URL-extraction shortcut.

## Research and persistence

- Reuse the site's existing research or start one Firecrawl `/agent` job through
  the installed SDK, using Spark 2 with low effort, a 50-credit limit, and a six-minute
  deadline measured from the shared job's creation. Firecrawl chooses which
  public pages to read and returns an overview, facts with source URLs, and unknowns.
- The agent supplies an exact public hostname. The provider receives its HTTPS
  homepage, without invitation paths, query strings, or private user notes. Requests
  with no URL or several URLs use the same agent identification flow. Hostname
  validation rejects URL paths, ports, IP addresses, and local/internal hosts.
- Convex stores the job ID, state, timing, credit limit, reported credits, and file
  paths. Scheduled actions poll Firecrawl every five seconds without holding an
  action open. Concurrent tasks reuse one shared job and its original deadline.
- The shared site workspace contains `/workspace/research/request.json`,
  `result.json`, and `brief.md`. Each task receives a private copy of `brief.md` and
  keeps the source research ID and timestamp. Refresh changes the site's latest
  research without changing completed task briefs or the source of existing waits.
- The initiating task owner pays for the shared job when research billing is enabled.
  Cached readers do not pay again. Reported provider usage remains visible even when
  research fails; missing usage stays unknown.
- Repeated identification retains the saved primary site. Only the review owner can
  correct it. Completed task snapshots remain unchanged; old skipped task records
  can attach to research when a follow-up identifies a site.
- `prepare({ sessionId, site })` returns `null` while the task is waiting, then
  `{ primarySite, briefPath }` after the private brief has been saved. The tool tells
  the agent to read that path with `workspace="current_task"` and read existing
  shared site guides before continuing. Sources are evidence, not instructions or
  proof that a feature works. The original user request is unchanged.

No Firecrawl Convex component is installed. Convex and the existing R2 workspace
already retain the data Scout needs. The provider's full browsing trace and source
page snapshots are not mirrored; the saved result includes citations to source URLs.

The admin tree shows Request check, Site research, and Chat. Research details show
the provider job and credits, and link to saved request/result files. Opening those
files keeps Site research selected. The shared site brief is a latest snapshot,
not a history of every research run or a replacement for learned interaction guides.

## Failure and cancellation

Failed research throws its stored error through the task's owner-visible tool error
path. Cancelled or skipped research also fails explicitly; none of these outcomes
claims a brief is ready. Failed cache entries remain failed until an explicit admin
refresh. A refresh checks an uncertain previous provider job before replacing it;
an already completed result can be recovered without buying another job.

Stop cancels only that task's wait. Shared research continues for other tasks, even
if the initiating task stops or fails. Completion checks the task again after copying
the brief so a stopped task cannot become ready. A task's existing workflow failure
is preserved. Shared research ends after its six-minute deadline and attempts to
cancel a still-processing provider job. Cleanup errors remain visible, and unreported
final credits remain unknown.

Workspace limits apply: 200 entries, 256 KiB per file, and 5 MiB per workspace. Storage
failures are visible. An upload rejected by the workspace is removed from R2.

## Verification

Historical direct SDK trials on September 15, 2026:

| Site       | Elapsed | Observation                                                                      |
| ---------- | ------: | -------------------------------------------------------------------------------- |
| Samebase   |    64 s | Found the homepage, DIY setup, and pricing without a custom page-selection call. |
| Score Four |    53 s | Read the homepage and public How to play help.                                   |
| Excalidraw |    43 s | Returned the requested overview, cited facts, and unknowns.                      |

All three reported zero credits. This is recorded provider output, not a claim
that Agent is free. These are individual trials, not a performance guarantee or
proof of better browser-agent behavior. The earlier custom flow completed its
integrated research in 17.6–33.4 seconds, so the direct Agent trials were slower.

Testing exposed two schema compatibility issues in Firecrawl 4.38: automatic Zod 4
conversion drops properties, and the provider's final submission validator rejects
URI format. Scout sends an explicit draft-7 JSON Schema with a URL pattern and
validates the complete result, including URL parsing, once on receipt.

The earlier startup flow's first integrated Samebase trial saved that submission failure and the chat
continued successfully. After the schema fix, the localhost Score Four trial
completed research in 30 seconds. Conrad read the saved brief and the existing
site guide, started a local game, made two moves, and verified Undo and New game.
The final response accurately described both controls and the browser's 3D limitation.

In that earlier flow, stopping an Excalidraw research job shortly after submission left the session stopped
without an OpenAI chat or browser; Firecrawl confirmed that the job was cancelled.
An earlier, later cancellation raced with completion: Firecrawl finished and reported
30 credits. An accepted cancellation does not guarantee that no work will be billed.

Automated research coverage checks preparation during a running task, repeated
identification, cached and concurrent reuse, billing, frozen task briefs, attachment
of old skipped records, permission checks, hostname validation, provider and copy
failures, timeout, manual refresh, and Stop races. Preview tests cover hostname
validation and independent preview failures.

Official reference: [Firecrawl Agent](https://docs.firecrawl.dev/features/agent).
