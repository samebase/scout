# Site research before browser work

September 15, 2026. This is a tested prototype and proposed integration, not an
enabled startup step. No production data, agent instructions, or review workflow
was changed. The experiment made public Firecrawl requests and OpenAI Responses
calls without starting a browser or using Scout accounts.

## What to add

Keep one conversation. Its flat admin tree would contain Request check, Site
research, Chat, and any later Resume checks. Site research is one bounded job in
the existing Convex workflow, after admission and before `runtime.begin`. It does
not need another Scout, an inbox, a browser profile, or a manager agent.

For a review with an identified site:

1. Read the site's existing workspace and use relevant guides as dated evidence.
2. Read the public entry page with Firecrawl Scrape, requesting Markdown and links.
   Map can supply additional candidates; its results are discovery hints.
3. Select zero to two relevant public sources and read them. Do not crawl the whole
   site by default. A small model call can choose from the actual candidate list.
4. Produce a short briefing with sources, entry points, documented prerequisites,
   and specific unknowns. Give the browser agent this context and the file paths.
5. Start the same browser chat with the original request intact. It still needs to
   use the product and verify results.

Research content belongs in files. Reusable public findings belong in the existing
site workspace. Private requests, account details, and task-specific plans belong
to the session. Each session must retain the exact briefing it received so later
site-guide edits do not change the explanation of an earlier run.

The initial check currently returns a title and decision, not a primary URL.
Extend that result to select an explicit supplied URL when the subject is clear.
Validate that selection against the supplied URLs. If no site can be identified,
record a skipped research step and let the chat resolve the task; do not invent a
domain or silently pick the first OAuth or invitation link as the product.

Add a research record linked by `sessionId`, with a discriminated state and fields
for the target, timings, source/file references, model calls, and provider usage.
This is separate from `agentsApiRequestChecks`, whose records and results model
approval decisions. The sidebar can display both without introducing a generic
workflow engine or changing the single Chat.

Selecting Site research should show the briefing and sources in the main panel;
the right inspector should show requests, responses, elapsed time, and usage.
Members keep the existing conversation view. No new public page is needed.

If research fails, show that failure explicitly. It should not imply the site is
broken or prevent the browser from trying a site that needs interaction to read.
Only the admission decision gates whether the task is allowed. Stop must prevent
a late research result from starting the browser. Do not repeat initial research
on every message or human-handoff resume.

## Real trials

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

This proves that gathering a briefing is feasible. It does not yet show improved
browser-agent behavior. Before enabling it for all reviews, compare the same task
with and without the briefing, checking unnecessary research calls, invented
requirements, and completion of the actual product task. The previous Agents API
startup stall prevents treating briefing generation as an end-to-end review test.

## Run the prototype

With `FIRECRAWL_API_KEY` and `OPENAI_API_KEY` already configured in the process
environment, run from `apps/scout`:

```text
node scripts/probe-site-research.ts https://example.com/ <new-output-directory> --request "Try the site as a first-time visitor."
```

The output directory must not already exist. An optional `--guide guide.md` lets the trial
use a downloaded copy of existing site knowledge. It does not overwrite shared
guides. Keep output outside the repository: site-specific research is data, not
hardcoded agent instructions. Do not pass private URLs or private guide contents.
The optional request guides source selection but is not passed to the reusable
briefing call. Its saved request/response files are private experiment records.

The script saves complete source responses, structured source selection, a Markdown
briefing, complete model requests/responses including usage, and elapsed times.
Provider or validation errors remain failures; there is no automatic retry.

Firecrawl documentation: [Map](https://docs.firecrawl.dev/features/map) and
[Scrape](https://docs.firecrawl.dev/features/scrape).
