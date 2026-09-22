# TrailScout submission

Submitted on September 22, 2026: https://vibeapps.dev/s/trailscout.
This maintained copy may include later edits. Changes here do not update the Vibe Apps entry.
Keep the shared copy below synchronized with `apps/scout/src/routes/about.tsx` in the
same change. The About page stays hand-written JSX; there is no automatic Markdown
rendering or generation between the two files.

## Submission fields

- **Project name:** TrailScout
- **Tagline:** Check if a product does what you need.
- **Live app:** https://doting-crab-687.convex.site
- **Repository:** https://github.com/samebase/scout
- **Build log:** [hackathon.md](../hackathon.md)
- **Demo video:** https://youtu.be/FHzS5r6Qb_U
- **Build announcement:** https://x.com/nicu_tsx/status/2102449379307086013
- **Submitted entry:** https://vibeapps.dev/s/trailscout

See [the researched requirements](./hackathon-submission-requirements.md) and
[the submission checklist](./hackathon-submit-checklist.md).

## Shared About and submission copy

### Send a Scout to try a website.

TrailScout sends AI agents to try websites for you. Give a Scout a website and a task.
It uses a real browser and leaves a walkthrough, screenshots, and a replay showing what
worked, what failed, and what it could not verify.

You can watch a Scout work live or come back to its review.

### Public reviews help more than one person.

Reviews are public by default, with a private option. Anyone can read a public review
without an account, so one person's task can help others decide whether a product is
worth trying.

Follow-up questions extend the same walkthrough, keeping earlier findings alongside new
evidence. Create an account and verify your email to start your own tasks.

### A Scout has its own identity.

Each Scout has a name, its own email inbox, and a browser profile that stays with it
across tasks. It can sign up for services, read verification emails, and return using
the accounts it has already created.

You can [meet the Scouts](https://doting-crab-687.convex.site/scouts) and see their
public work and the sites where they have accounts.

### Files for each conversation and each site.

A workspace is a saved collection of files that a Scout can read, edit, and use to
run code. Every conversation has a private workspace for its research, notes,
scripts, and task data.

Site workspaces are separate. Each belongs to a website's hostname and is shared
across conversations and Scouts visiting that site. Reusable research, guides, and
scripts go there, so later visits can build on earlier work. Private task data stays
in the conversation workspace.

### Before the browser work starts.

Before testing a product, a Scout can use Firecrawl to research its public pages and
documentation. It saves a briefing with source links, product details, and unanswered
questions, then uses that context during the browser visit. Existing research and
site guides can be reused on later visits.

Each new task also goes through a request check for disallowed activity, including
fraud, credential theft, and unauthorized access.

### A Scout can ask for help.

If a CAPTCHA or another step needs a person, your Scout can pause and email you from its
own inbox. A private link lets you take over the browser without another TrailScout
sign-in. The handoff page explains what needs your attention.

When you resume, TrailScout checks the current browser pages against the original task
before continuing. The help window has a deadline; if it expires, the task stops and
the browser closes.

### How TrailScout is built.

#### Convex

TrailScout started with the Convex Agent component. It still powers one of the two
execution engines, with conversation threads, persisted messages, and model calls
through Convex AI Gateway. TrailScout supplies the browser, email, and workspace tools.

- The Workflow component coordinates request checks, site research, agent turns,
  and human handoffs.
- The R2 component handles file storage for workspaces, screenshots, and site
  previews in Cloudflare R2.
- The Static Hosting component serves frontend assets. The TanStack Start
  integration renders public pages through Convex HTTP actions.

Convex Auth handles sign-in. The database keeps Scout identities, accounts,
review evidence, and credit balances alongside the task history.

#### OpenAI

Luna is the default model and runs through the OpenAI Agents API. OpenAI also
handles the request and post-handoff checks and turns review evidence into the
final walkthrough. TrailScout offers Luna through Convex Agent too, alongside Qwen
3.7 Flash and DeepSeek V4 Flash through Convex AI Gateway.

I used Luna for most development reviews because it produced better reviews in my testing.

#### Firecrawl

Firecrawl Agent, using Spark 2, researches public pages and returns the briefing
with citations. Firecrawl Browser supplies the remote sessions and persistent
profiles that Scouts use to test products. TrailScout connects through Playwright
over CDP to navigate, fill forms, manage tabs, and capture screenshots.

The sessions also provide live views for watching and taking over, plus
recordings for replay. A separate Firecrawl Scrape call captures public
homepage previews without using a Scout's signed-in browser profile.

#### AgentMail

Each Scout gets its own AgentMail inbox. Its email tools let it read threads,
retrieve verification codes and links, and send email as part of a task. When a
Scout needs a person to take over the browser, the help email comes from that
same inbox.

#### just-bash

Both workspace types use just-bash inside Convex Node actions. Scouts use shell
commands to search and edit files, and js-exec to run JavaScript or TypeScript in
QuickJS WebAssembly with a virtual filesystem. Files persist between commands,
so a Scout can write a script, run it, and use its output later in the task.

#### Cloudflare R2

A private R2 bucket stores workspace files and review screenshots. Convex checks
access to the review before issuing a signed image URL. A separate public bucket
and cached media domain serve homepage previews for public sites.

#### Polar

Verified accounts get 50 free TrailScout credits to get started. I use the available
Firecrawl allowance to include browser sessions and site research during the
beta. AI model calls, request checks, and hosted web search consume TrailScout credits
to help cover their cost.

Members can buy more credits through Polar checkout. Signed payment and refund
webhooks update the Convex credit ledger. Credit history shows purchases, usage,
and the remaining balance.

#### PostHog

PostHog helps me understand how people use TrailScout through product analytics and
optional recordings of TrailScout's own interface. Session recording requires
opt-in and can be turned off in Settings. Passwords and marked private content
are masked, and embedded remote browsers are excluded.

The frontend uses TypeScript, React, and TanStack Start.

### What was difficult.

#### Choosing what TrailScout should be

The hardest part was deciding what TrailScout should be. I started with a general
direction, but no clear picture of the product. I had to work that out as I built.

For a while, I considered making one product for playing browser games with a
Scout and another for reviewing websites. I eventually focused on trying websites
for people and showing what happened. That focus was still taking shape in the last
few days, even with much of the technical work already in place.

#### Building and guiding the agent

I had usually relied on existing agent tools and left agent infrastructure to
others. TrailScout meant building one myself. The Convex Agent component made getting
started straightforward, but there was still a lot to learn about directing the
agent and managing what it could see.

Browser observations and tool results fill the context quickly. I added
summaries of older turns and removed outdated browser snapshots from model input,
while keeping the full history as evidence. I also had to make my expectations
explicit: research the product, try the requested behavior, check the result,
and support findings with evidence.

When OpenAI released the Agents API during the build, I tried that too. I then
put both engines behind a common interface, sharing the browser, email, and
workspace tools, checks, and walkthroughs. New tasks can use either engine. The
Convex runtime manages its context compaction; the Agents API manages its own.

#### Making the evidence readable

I first explored turning each browser recording into an automatically edited video
with MediaBunny. I found Firecrawl's replay endpoints in its source code; they were
not exposed in the SDK or public API documentation I was using.

In my trials, the recordings were lower quality than direct screenshots, and their
timing did not consistently match the browser actions. Parts appeared faster or
slower, which made automatic cuts and click alignment unreliable.

I set aside the automatic editing plan and made high-resolution screenshot
walkthroughs the main way to read a review. TrailScout captures PNGs directly from the
live browser at twice the viewport resolution and pairs them with the steps and
findings. Replay remains available, and MediaBunny still powers MP4 export.

#### Technical choices and tradeoffs

I wanted the homepage's initial product list to arrive in the first HTML
response, so visitors could start browsing without waiting for client-side
queries. I ran TanStack Start's server renderer inside a Convex HTTP action and
patched the Static Hosting component to route page requests to it. The tradeoff
is maintaining that adapter and patch as dependencies change.

I also built the workspace from an in-memory just-bash filesystem, with file
contents saved in R2 between commands and metadata in Convex. This gave the agent
a persistent place to write scripts and process research within the existing
backend. I had to teach it when to save material, how to read it back, and which
files belonged in the private conversation workspace or the shared site workspace.

### Built for the All Gas Hackathon.

I built TrailScout for the [Convex All Gas Hackathon](https://www.convex.dev/hackathons/all-gas).

[Watch the demo](https://youtu.be/FHzS5r6Qb_U) ·
[Source code](https://github.com/samebase/scout) ·
[Announcement on X](https://x.com/nicu_tsx/status/2102449379307086013) ·
[Hackathon entry](https://vibeapps.dev/s/trailscout)

[Send a Scout to a website](https://doting-crab-687.convex.site)

## Working notes, not public copy

### What felt difficult

The builder confirmed this order and emphasis on September 21. Both public drafts use
that account rather than inferring difficulty from the number of commits.

- **Product direction comes first:** This was the main challenge from the start.
  The builder began with a general direction and worked out the product while building.
  The plan for separate game-playing and website-review products gave way to trying
  websites and showing results, with the focus still changing in the final days. The
  Play route remains in code; this is a positioning decision, not a claim that it was deleted.
  Supporting history includes `25dfdc6`, `d9b6acc`, `dc8b381`, and `a53e82f`.

- **Building and guiding the agent:** The Convex Agent component made the foundation
  approachable. The builder had usually relied on existing agent tools, so context
  management, compaction, prompting for research and evidence, and reliability were
  substantial new work. The later Agents API experiment led to a common task interface
  for both engines. Supporting changes include `3cb697d`, `fe13de6`, `a027431`, `570fe3f`,
  and `e1b53f4`, plus the current shared-task runtime.
- **Replay and evidence:** The builder found replay endpoints in Firecrawl's source,
  encountered limited quality and inconsistent timing, and set aside automatic editing
  in favor of screenshot walkthroughs. MediaBunny's MP4 export remains implemented.
  Supporting changes include `25d71cd`, `b4dd421`, `f97f1c1`, `0973d9f`, and `109fec8`.
- **Technical choices and tradeoffs:** Group the less conventional integrations in one
  section after replay. TanStack Start renders the initial product list in a Convex HTTP
  action, using a local adapter and a Static Hosting patch. The just-bash workspace uses
  R2 for file contents and Convex for metadata. Explain the product purpose and the
  integration or agent-guidance work; do not present each as a separate major challenge.

Human help remains an important capability, but the builder did not identify it as a
main challenge. Trustworthy reviews and agent reliability belong within the agent
story. Do not describe Luna as unintelligent or invent benchmark results. Use first-person
singular consistently for the builder's experience and decisions. Codex was the coding
tool, not a separate human teammate. Explain earlier product ideas in plain language
instead of introducing unexplained names such as Play.

### Evidence for the shared copy

- **Request checks and research:** `apps/scout/convex/tasks/requestCheckModel.ts`,
  `lifecycle.ts`, `siteResearch.ts`, `siteResearchSources.ts`, and `docs/site-research.md`.
  The initial check reads the request and supplied URLs; it does not browse or certify
  the target site. Site research is separate from testing the product.
- **Identity and accounts:** `apps/scout/convex/scout/model.ts`,
  `apps/scout/convex/tasks/instructions.ts`, and `docs/scout-credential-store-decision.md`.
  Browser profiles retain sessions, while the account store distinguishes prepared
  credentials from confirmed accounts. Do not claim that passwords can never appear
  in provider recordings or live views.
- **Human help:** `apps/scout/convex/tasks/handoff.ts`, `handoffRecords.ts`, `sessions.ts`,
  and `apps/scout/shared/handoff.ts`. The private link is emailed from the Scout's inbox;
  returning control triggers a fresh check. Public copy avoids timing constants, which
  have changed during development.
- **Review evidence:** `apps/scout/convex/tasks/instructions.ts` and `walkthroughReport.ts`.
  Findings should distinguish direct observation from site claims, retain earlier
  evidence across follow-ups, and record passed, failed, and untested outcomes.
- **Access:** `apps/scout/shared/accessModel.ts` and `apps/scout/convex/access.ts`.
  Public reading and permission to start a task are separate.
- **Stack:** `apps/scout/convex/convex.config.ts`, the task runtimes, and
  `docs/agent-runtime.md`. The default Agents API runtime and the Convex Agent runtime
  are different execution options; do not describe every task as using both.
  The registered components are Agent, Workflow, R2, and Static Hosting. Convex Auth
  handles authentication separately. `apps/scout/convex/tasks/convexAgent.ts` shows
  TrailScout's context selection and summarization around the Agent component; the Agents
  API owns compaction for its runtime. An existing task does not switch engines midway.
- **SSR integration:** `packages/convex-tanstack-start/README.md`,
  `docs/convex-ssr-experiment.md`, and
  `patches/@convex-dev__static-hosting@0.2.1.patch`. The patch adds a routing fallback
  to Static Hosting; it does not patch the Convex core runtime. The adapter supplies
  compatible build settings and a buffered renderer. The initial public list is in
  the HTML; additional pages still load through pagination. Do not promise instant
  loading, all products in the first response, or a measured speedup without data.
- **Model choices:** `apps/scout/shared/taskModels.ts` and
  `apps/scout/convex/tasks/README.md`. The builder reports that most development reviews
  used Luna and that its review quality was better. This is the builder's experience,
  not a measured win rate or general model benchmark.
- **Firecrawl services:** `apps/scout/convex/tasks/siteResearchSources.ts`,
  `siteResearchModel.ts`, `apps/scout/convex/scout/sitePreviews.ts`, and `playwrightBrowser.ts`.
  Agent with Spark 2 produces the briefing, Browser provides the persistent-profile
  sessions, and Scrape captures separate public homepage previews. Research is not a
  safety verdict or a test of the site's claims.
- **Workspace and code execution:** `docs/workspaces.md`,
  `apps/scout/convex/scout/workspaceShell.ts`, and `apps/scout/convex/tasks/tools.ts`.
  just-bash runs inside Convex with a virtual filesystem and bounded QuickJS execution.
  It is not an unrestricted computer or full Node environment. Task and site workspaces
  are separate, and workspace files persist in R2. `apps/scout/convex/workspaceModel.ts`
  defines the private conversation scope and the shared exact-hostname scope; private
  task state and credentials do not belong in shared site files.
- **R2 delivery:** `apps/scout/convex/scout/publicSitePreviews.ts`,
  `apps/scout/convex/tasks/screenshots.ts`, and `screenshotRecords.ts`. Public previews
  use the public bucket. Review screenshots use the private bucket even when the review
  is public; access to a signed image URL follows the review's visibility.
- **Credits and monitoring:** `apps/scout/convex/polar.ts`, `creditPurchases.ts`,
  `docs/credits.md`, and `apps/scout/src/lib/posthog.ts`. Polar checkout, signed paid and
  refund events, and the ledger are implemented. PostHog tracks product usage and
  opt-in interface recordings; automatic exception capture is disabled, so do not call
  this an error-monitoring integration. Current code takes precedence over older
  masking details in `docs/analytics-research.md`.
  `creditPolicy.ts` and `creditLedger.ts` confirm the 50-credit grant for verified
  accounts and Firecrawl browsing/research included by default. The builder confirms
  this uses the project's available Firecrawl allowance. Omit the changing provider
  balance and do not promise permanent free usage or exact cost pass-through. AI calls,
  request checks, and hosted web search remain billable in TrailScout credits.
- **Replay tradeoff:** The builder's account, the v150 build-log entry,
  `docs/admin-replay-editing.md`, `docs/browser-screenshot-research.md`,
  `apps/scout/convex/scout/lib/firecrawlReplay.ts`, `playwrightBrowser.ts`, and
  `apps/scout/src/lib/renderBrowserReplay.ts`. The source-only replay adapter, 2x PNG
  capture, and retained MediaBunny export are visible in the implementation. The
  variable-speed experience and decision to abandon automatic editing come from the
  builder's account; do not invent drift measurements or blame the export library.

### After submission

The submitted entry is live at https://vibeapps.dev/s/trailscout. Publication work and
checks that have not been confirmed are tracked in [the checklist](./hackathon-submit-checklist.md).
The submitted description still includes the Samebase demo sentence removed from this
maintained copy. Updating that description requires editing the Vibe Apps entry separately.
