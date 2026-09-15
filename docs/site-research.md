# Site research before browser work

Implemented September 15, 2026. New Review conversations run Site research after
request approval and before the OpenAI browser agent starts. The same chat and
existing Convex workflow continue afterward; no additional Scout is reserved.

## Startup and storage

- Research runs once for an approved Review whose explicit HTTPS URLs name one
  public hostname. It uses the homepage, stripping invitation paths, queries, and
  fragments. Missing or ambiguous sites produce an inspectable skipped step.
- Read up to three existing Markdown guides (excluding generated research folders),
  newest first. Treat these as historical evidence, not proof of current behavior.
- Scrape the homepage, Map up to 25 links, and ask Luna low to select zero to two
  additional pages from observed same-site candidates. Read those pages and create
  a short cited brief. The original request guides selection but is excluded from
  the reusable briefing call.
- Save files under `/workspace/research/<research-id>/`. Public pages, guide snapshots,
  and the briefing are copied into the site workspace. Each session retains its
  own copies plus the private provider requests/responses. Convex also retains the
  exact briefing text, state, call timings, reported usage, and file paths.
- Tell the browser agent to read its briefing before browser actions. Its original
  user request is unchanged. Research does not constitute a completed review.

The admin tree contains Request check, Site research, and one Chat, plus resume
checks when needed. Research citations and call details link to the session's
private workspace. The chat cost includes the research model estimate; Firecrawl
scrape credits are shown separately. Map does not report billed credits, and no
plan-specific dollar rate is guessed.

Research failure is visible in Agents and does not block an approved browser task.
Stop prevents later provider calls and browser startup after the in-flight request
returns. Failed jobs do not retry automatically. This is not a website safety
scanner; the request check still precedes every research request.

Workspace limits still apply: 200 entries, 256 KiB per file, 5 MiB per workspace.
Research also bounds individual page text to 60,000 characters and each selected
guide to 20,000. Oversized sources fail visibly rather than being silently shortened.
Generated research directories accumulate; use existing workspace tools to remove
old shared research when capacity is reached. Private session copies remain separate.

## Integrated localhost trials

- Score Four: research took 17.6 seconds, loaded the shared guide and homepage,
  and selected no additional pages. Conrad's first tool read the briefing through
  Bash. He verified local moves, Undo, and New game, reported observed board changes,
  and closed the browser. Session: `s573ncvx4mbdh71tc0yd73cy2n8eem1b`.
- Excalidraw: research took 18.4 seconds and produced a briefing. The managed chat
  then failed with an empty OpenAI 404 before using the browser. That trial does
  not establish whether the briefing improves canvas interaction. Session:
  `s572awt4vttx68sgapxz1yz2sh8ef35n`.
- Stop: stopped a Samebase review while research was running. Research finished
  cancelled; the Scout reservation cleared and no OpenAI session or browser was
  created. Session: `s577c7qnmzbyra5sdygm7dn9es8eejh8`.
- Samebase: research took 33.4 seconds and selected the DIY and Cloudflare setup
  documentation alongside the homepage. Conrad read the briefing, inspected the
  shared workspace, and then opened the browser. The Agents API returned the same
  empty 404 during browser startup; cleanup released the Scout and closed the
  browser. Session: `s570pwnazm25sd1g4mxnyzg8ts8efmad`.

These are individual trials, not an A/B measurement of improved agent performance.
The earlier standalone script was removed after integrating the implementation;
start a Review through localhost to exercise the real workflow.

## Earlier prototype trials

The prototype used fresh public-page scrapes, one Map request, and two Luna low
Responses calls per site. Sources, selection reasoning, complete model calls, and
timings were retained in local output directories.

| Site       | Total time | Pages read | Outcome                                                                         |
| ---------- | ---------: | ---------: | ------------------------------------------------------------------------------- |
| Score Four |     12.7 s |          1 | Used the existing shared guide; selected no extra pages.                        |
| Excalidraw |     13.3 s |          1 | Skipped developer/API and paid-product docs as irrelevant to the public canvas. |
| Samebase   |     16.8 s |          3 | Found Cloudflare setup and DIY docs, including provider-account prerequisites.  |

These are individual observations, not latency guarantees. Each successful scrape
reported one Firecrawl credit. Map billing is documented as one credit per call;
the tested SDK response did not include billed credits. Model usage is saved in the
response files, rather than inferred from text length.

What the trials changed:

- A fresh landing-page read took about two seconds. Map initially took 4.6–6.8
  seconds, returned nothing for Score Four, and later returned a sitemap. It cannot
  establish that a site has no other pages or replace live navigation.
- Samebase's initial response contained large inline SVG image URLs. Excluding
  image/SVG tags reduced its Markdown to roughly 6 KiB while keeping text and links.
- Excalidraw's map was mostly developer documentation. Selecting the first few
  results would have given the agent irrelevant context.
- Existing Score Four knowledge was more useful than the landing page. The guide
  covers accessible peg names and historical local-game results that Scrape cannot
  discover without interaction.
- The first briefs repeated caveats and generic browser instructions. A shorter
  format produced roughly 150–200 words of facts and specific gaps. Retrieval dates
  must be distinguished from dates of actual prior interaction observations.
- Samebase's DIY material is less relevant to testing the hosted onboarding. Source
  selection now accepts the actual review request privately. Repeating with “Try
  Samebase by creating a disposable app. Check that the deployed app actually works”
  selected the public dashboard/sign-in page and Cloudflare setup guide instead of
  the DIY guide, and completed in 11.6 seconds. A generic site briefing can still
  include material unrelated to a particular task.

Firecrawl documentation: [Map](https://docs.firecrawl.dev/features/map) and
[Scrape](https://docs.firecrawl.dev/features/scrape).
