# Site research before browser work

New Review conversations gather public site information after request approval and
before the OpenAI browser agent starts. This is one step in the existing Convex
workflow, followed by the same Chat. It does not reserve another Scout.

## Research and persistence

- Start one Firecrawl `/agent` job through the installed SDK, using Spark 2 with low
  effort, a 50-credit limit, and a three-minute deadline. Firecrawl chooses which
  public pages to read and returns an overview, facts with source URLs, and unknowns.
- Research only starts when the request names one public HTTPS hostname. The input
  is its homepage, without invitation paths, query strings, or private user notes.
  Ambiguous requests get an inspectable skipped step.
- Convex stores the job ID, state, timing, credit limit, reported credits, and file
  paths. Workflow actions poll every five seconds without holding an action open.
- Each chat keeps `/workspace/research/brief.md`, `request.json`, and `result.json`.
  The site workspace receives the latest public `research/brief.md`; earlier chats
  retain their own copies. Raw provider responses stay private to the chat.
- The browser agent is told to read its briefing and existing shared site guides
  before browser actions. The original user request is unchanged. Reading public
  documentation does not establish that the product works.

No Firecrawl Convex component is installed. Convex and the existing R2 workspace
already retain the data Scout needs. The provider's full browsing trace and source
page snapshots are not mirrored; the saved result includes citations to source URLs.

The admin tree shows Request check, Site research, and Chat. Research details show
the provider job and credits, and link to saved request/result files. Opening those
files keeps Site research selected. The shared site brief is a latest snapshot,
not a history of every research run or a replacement for learned interaction guides.

## Failure and cancellation

Research failure remains visible and does not prevent an approved browser task.
There are no automatic retries. Stop is checked before submission and between polls;
a job submitted while Stop arrives is cancelled. The workflow cancels timed-out jobs,
and existing session cleanup also cancels unfinished research after workflow failure.
Firecrawl cancellation is cooperative, so unreported final credits remain unknown.

Workspace limits apply: 200 entries, 256 KiB per file, and 5 MiB per workspace. Storage
failures are visible. An upload rejected by the workspace is removed from R2.

## Verification

Direct SDK trials on September 15, 2026:

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

The first integrated Samebase trial saved that submission failure and the chat
continued successfully. After the schema fix, the localhost Score Four trial
completed research in 30 seconds. Conrad read the saved brief and the existing
site guide, started a local game, made two moves, and verified Undo and New game.
The final response accurately described both controls and the browser's 3D limitation.

Stopping an Excalidraw research job shortly after submission left the session stopped
without an OpenAI chat or browser; Firecrawl confirmed that the job was cancelled.
An earlier, later cancellation raced with completion: Firecrawl finished and reported
30 credits. An accepted cancellation does not guarantee that no work will be billed.

Automated coverage also checks repeated research replacing the shared site's latest
brief while retaining the earlier chat's copy, rejected-upload cleanup, schema
validation, provider failure, timeout, and Stop races.

Official reference: [Firecrawl Agent](https://docs.firecrawl.dev/features/agent).
