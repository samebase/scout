# Scout demo video draft

Historical planning draft. The current script and recording plan are in
[video_plan.md](../video_plan.md). Use the [submission checklist](./hackathon-submit-checklist.md)
for the remaining work; retain this draft as the earlier planning record.

Working proposal, September 21, 2026. No new review or recording was started for
this draft. Samebase is the preferred main example; the CAPTCHA segment still
needs a real recorded handoff.

Target 2:40, including pauses and clicks. The [event rules](https://www.convex.dev/hackathons/all-gas)
require a video under three minutes and favor actual product interaction.

## The story

Someone wants to know whether a website can do what they need. Scout tries it
using its own identity, asks for help when necessary, and leaves evidence the
person can inspect. Samebase provides a concrete question with a visible result:
can Scout sign up, create a working app, and verify that its data persists?

Disclose that Samebase is also the builder's product. Keep Scout's interface and
the review question central. Samebase supplies the website being tested; it is
not the hackathon submission. Briefly show other reviews so the viewer sees the
broader use of Scout. The event favors everyday apps over developer-only tools.

## What is already supported by evidence

- The [public Samebase review](https://doting-crab-687.convex.site/tasks/s57326vkyc73m48f6294aaf1ad8enkyx?scope=public&view=walkthrough)
  shows John signing in through its GitHub account and reaching Repositories.
  It does not show creating an app or connecting an organization.
- [Earlier development trials](./review-trials-2026-09-10.md) created a disposable
  Samebase app and checked a todo after reload. One trial required a manual
  continuation after an infrastructure failure. These are historical observations,
  not proof of a current complete production run.
- A current completed CAPTCHA-to-resume recording has not been selected or
  verified. Samebase does not reliably provide that event for the proposed task.

## Proposed Samebase task

> Create a Samebase account and create an app.

Scout should discover the steps itself. Choose the footage and write the final
narration from the actual run.

## Recording setup

The planned starting state is a fresh Samebase account with existing GitHub,
Convex, and Cloudflare accounts. Select a suitable Scout and verify this setup
before recording. The Cloudflare account should already have its Workers
Builds API token and GitHub authorization for the repositories that will be
created. [Samebase's setup guide](https://samebase.com/docs/cloudflare-setup)
describes that one-time preparation and reuse for future apps.

This skips Cloudflare's temporary-Worker/token-creation procedure. Samebase still
needs its own provider connections and permissions during onboarding. Show the
fresh Samebase signup and those connections, with long waits shortened. Mention
that the provider accounts and Cloudflare setup were prepared beforehand.

## Narration and shots

These are proposed words for a successful recorded run. Revise the result lines
to match the actual evidence before recording the voiceover.

### 0:00 to 0:20: the question

Show Scout's homepage, a few existing reviews, and the request.

> Every website has a pitch. Finding out whether it does what I need usually
> means signing up and trying it myself. I built Scout to make that first visit
> for me and show me what happened.
>
> For this example, I'm using Samebase, another product I built. Can Scout sign
> up, create an app, and check that it actually works?

### 0:20 to 0:45: the Scout

Show the chosen Scout's identity, GitHub sign-in to a fresh Samebase account,
and brief excerpts of connecting the existing providers. Keep account secrets
out of the frame.

> Each Scout has its own identity, email inbox, and browser profile. It can use
> accounts it already created and come back later. This one already has its
> provider accounts, with Cloudflare's one-time setup done beforehand. Here it
> creates its own Samebase account and connects them.

### 0:45 to 1:20: using the product

Show real excerpts of Samebase app creation, the deployed starter app, completing
the todo, and reloading. Label skipped waiting time. Keep enough of Scout's UI in
view to make it clear who is doing the work.

> Scout opens Samebase, creates the app, and follows the deployed link. Then it
> tests the result. It adds a todo, marks it complete, and reloads the page to
> check that the data was saved.

### 1:20 to 1:40: a separate human handoff

Use an actual CAPTCHA encountered in another task. Show the pause, the email
from the Scout, the private takeover page, the person completing the check, and
the resumed Scout. Introduce the change of task visibly. Crop the private bearer
URL and unrelated inbox content. Do not display a verification code or password.

> Sometimes a website needs a person. This is a separate review where Scout hit
> a CAPTCHA. It paused and emailed me a link. I opened the same browser, completed
> the check, and handed control back so Scout could continue.

Include this narration only after capturing that complete sequence. Do not
manufacture a blocker or claim a staged pause was a CAPTCHA. If no suitable
recording is available, explain the capability briefly and use the saved time
for the main review.

### 1:40 to 2:10: the answer and evidence

Return explicitly to the Samebase review. Open the walkthrough, move through its
screenshots, and briefly play the replay. Show the saved completed todo after
reload as the central result.

> Back in the Samebase review, I can see the result and the evidence behind it.
> The completed todo survived reload. The walkthrough shows the steps, and I can
> open the screenshots or replay to inspect what happened.
>
> Reviews are public by default, so the next person can read this before trying
> the same product.

### 2:10 to 2:35: how it works

Show the About technical section or simple labels over the corresponding Scout
screens. Avoid spending this segment reading provider dashboards.

> Convex keeps the task state and runs the workflows. I started with its Agent
> component and added an OpenAI execution engine using the same tools. Firecrawl
> handles research and persistent browser sessions. AgentMail gives each Scout
> its inbox and sends those requests for help.
>
> Scouts also have saved file workspaces where they can keep research and run code.

### 2:35 to 2:40: close

Show the public Scout URL and review list.

> Give Scout a website and a question. See what happened before deciding for yourself.

## Before recording

- Select a Scout with no existing Samebase account and available GitHub, Convex,
  and Cloudflare accounts. Verify the Cloudflare Workers Builds token and GitHub
  repository authorization are already prepared before recording.
- Run the Samebase task on the current production app and inspect the report,
  screenshots, and replay. A failed check can be useful evidence; describe it
  accurately instead of replacing it with the planned successful outcome.
- Find or record the separate complete CAPTCHA handoff. Prefer an existing
  authorized task with a real blocker. Do not choose the main demo site solely
  to provoke a CAPTCHA.
- Record completed task evidence and edit down waiting time. Introduce the
  handoff as a second example, then visibly return to Samebase.
- Read the narration aloud with the footage. Shorten it to leave time for the
  viewer to understand the clicks, and verify the export stays under three minutes.
