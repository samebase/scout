# Member experience

Discussion checkpoint: September 14, 2026. Current behavior and remaining ideas are
separated below. Continue here or use this file to brief a new task.

## Aim

Make Scout useful and understandable to someone who is not an admin. Focus first
on completing an ordinary product review through the member interface, then use
what we learn to improve Play. Judge changes through actual product use, not more
speculative prompt edits.

## Direction from the discussion

- Make Review the main product: one starting composer and one review list, with
  site and public/my filters. Playing a game remains a task Scout can perform
  through the same input, rather than a second product in the main navigation.
  Private conversations stay out of public results.
- Keep a free-text starting box. A user should not have to complete a site
  registration form before asking Scout to try something.
- Give conversations a concise title separate from the original request, which
  remains intact in the transcript.
- Associate a product conversation with its primary site. A Samebase review stays
  about Samebase while Scout uses GitHub and Cloudflare for signup or deployment.
  Filtering by GitHub should find work about GitHub, not every OAuth visit.
- Reuse the existing hostname-based site concept. Shared site knowledge already
  exists; the missing relationship is between a conversation and its subject.
- Keep the simple conversation, live browser, replay, and download experience.
  Technical inspection remains available to admins.
- Keep UI copy sparse. Each label should identify something or help the user act.
  Preserve selectable text, mobile sidebar gestures, and the shared sidebar layout.
- Keep the shared Scout pool and one active conversation per Scout. The shared
  Firecrawl session limit also applies; more inboxes do not increase browser capacity.

## Current implementation

- `/` provides the Review composer, Public reviews, and My reviews. Site filters
  are stored in the URL. `/review?thread=…` opens a conversation. Existing Play
  conversations remain accessible through their URLs and Lab.
- The main navigation shows Reviews and Scouts for members, plus the existing
  admin tools for staff. Scout selection and visibility use shadcn Select controls.
- Review uses the OpenAI Agents API; Play still uses the Convex Agent. This product
  work does not require unifying or replacing those runtimes.
- `scoutChats.primarySite` stores the exact hostname once identified. The new
  Review agent tool `set_review_site` sets it once; the owner can correct it on
  the conversation page. Browser navigation does not write this field.
- Public and owner-only site queries use dedicated indexes. Site links on rows
  and conversations lead to the filtered review list. No workspace is required.
- Existing conversations without a site remain visible in the unfiltered list.
  Their owners can set the site; there is no automatic historical inference.
- New Agents API sessions first run one request check. It generates a short title
  while preserving the original request. Pending, declined, and failed checks stay
  out of public results; owners can see their request and rejection reason.
- Agents shows an always-expanded session tree with one complete Chat and flat
  Request check and Resume check entries. Selecting a check opens its evidence
  and decision in the main panel, with API input, response, timing, and cost in
  the right inspector. Check attempts stay in creation order; Chat is not split
  around them. Historical sessions have only Chat. There is no expansion state.
- The initial check judges the request and supplied URLs, not website contents. It does
  not browse, research, or certify a site's safety. The existing workflow starts
  the main agent only after approval. Failures remain visible for manual rerun.
- Returning control after a handoff captures the current browser tabs and runs a
  Resume check against the original task and handoff reason. Approval continues
  the same OpenAI session. Rejection or capture/model failure keeps the handoff
  paused and the Scout reserved; retrying creates a separate check. Stop prevents
  late approval from resuming the session. The check reads page text, not images,
  and cannot guarantee that a human will leave the browser unchanged afterward.
- `scoutWorkspaces` distinguishes chat and site workspaces. A site workspace is
  shared knowledge keyed by exact hostname, not a product catalog or a chat subject.
- Approved members can open Scouts from the main navigation and browse names,
  emails, and profiles through `access_scout_view`. Registration, provider resources,
  service accounts, and credential controls remain admin-only. Profiles show
  availability and the task reserving each Scout; members see public tasks and
  their own private tasks. Activity previews appear below the Scout's details.
- PR #99 adds admin inspection of member-created Reviews in Agents. Its changes
  are separate from this proposed member experience.

## Proposed first experience

1. A visitor opens a public review and sees what was requested, which site it is
   about, the Scout's observations, and the live browser or recording.
2. A member opens a Scout profile to see its name, availability, and public work.
   The Scout-owned email address can be shown as part of its identity. Whether
   signed-out visitors also see profiles and email addresses is still undecided.
3. The member starts a Review with a normal request, such as “What is this site?
   Try its main feature and tell me whether it works.” New reviews default to
   Public; the member can choose Private in the composer.
4. Once the subject is understood, the conversation gets a short title and primary
   hostname. Allow correction. Do not blindly choose the first URL or replace the
   subject when the browser redirects. A request without a known site can start
   without one and acquire the association later.
5. The member follows progress and the browser on the conversation page. They can
   recognize whether Scout is working, needs help, failed, or finished, and can
   use the appropriate existing controls without opening Lab or Agents.
6. The finished conversation is easy to find in My activity. If published, it is
   also discoverable by its primary site in the public feed and from the Scout's
   profile. The result and recording remain accessible after the run ends.

Member profiles should expose an intentional set of identity and activity fields.
Showing the Scout's email address does not grant inbox access, credentials, account
editing, or control over someone else's conversation. Reuse the profile route and
presentation where useful, but do not simply remove the guard from management queries.

## Implementation order to try

Member Scout browsing, site association, and request checks with concise titles
are implemented. A [site-research prototype](site-research-prototype.md) now tests
public source gathering before browser work. Three real trials produced briefings
in 13–17 seconds, but improved browser behavior still needs a comparison. Keep the
existing site workspaces and one chat; the proposed research step is not enabled.

Use recorded browser navigation for an optional “Other sites visited” view; it is
evidence of a visit, not a permanent dependency relationship. A site can have
conversations even if no shared workspace has been created. Later, the Sites page
can bring together conversations and shared knowledge, with access appropriate to
each. Do not make a workspace a prerequisite for starting or finding a review.

## Testing setup

Keep product development on the primary checkout at `http://localhost:5173`, using
the existing development deployment. Use the in-app browser for the admin and
Chrome for an approved member, both against that same backend. Start work through
the member interface and inspect the same conversation as admin when needed. Check
the signed-out experience separately. After merging, run a small production smoke
test of the published flow.

Separate Convex deployments do not isolate external Scout accounts. A Scout may
use the same real inbox, service logins, and Firecrawl profile in both environments.
Do not run that profile concurrently across environments; a password changed in
one environment can also invalidate the other environment's saved credential.
Moving selected Scouts to production is a separate task; this UX work does not
require moving the development app to production or building ongoing data sync.

Use `nicuchiciuc@gmail.com` for member testing in development. Its test password is
stored locally in the ignored `apps/scout/.env.member-test.local` file. Settings
shows the signed-in email so that each browser's identity is visible.

## Verification for that first slice

Resume-check trial, September 14: the production capture code and real OpenAI
classifier approved Example Domain, rejected a text-only prohibited-content
fixture at the same URL, and approved the restored page in a controlled Firecrawl
browser. All three captures preserved the open browser. The full Agents API trial
remained in progress with no turns or tool requests for about 20 minutes, so it was
stopped and the Scout released. Continuation through a real agent handoff still
needs a successful trial; backend tests cover approval, rejection, retries, and Stop.

Account-free reviews, September 15: Excalidraw export/reopen and Score Four local
play both passed admission and reserved different Scouts, but neither reached a
browser tool. Excalidraw failed on an empty 404 from OpenAI's session-items endpoint;
Score Four was stopped. Both Scouts were released. Minimal Agents API requests
with Luna and Astra also produced no turns or items, while Luna answered through
Responses in 1.5 seconds. This does not establish a general provider outage.
The trial exposed a product bug: creating the provider session hid the original
request before any messages arrived. The request now remains visible while the
conversation is empty, including after failure; pagination tests cover replacement
by the provider's message without duplicating it. End-to-end reviews need a rerun
when Agents API sessions can start.

- Use a real approved member account, not an admin account with hidden navigation.
- Start an ordinary review without coaching each tool call. Check that its short
  title and site describe the task and that the original prompt is preserved.
- Open the member's Scout profile and return to the same conversation. Reload and
  find the work again through My activity.
- Check progress, a final result or explicit failure, and replay on desktop and
  mobile. Record concrete obstacles rather than assuming a completed run is useful.
- Verify a published test review as a signed-out visitor; private test reviews
  must not appear through the feed, site filters, or Scout profiles.
- Verify the admin can inspect the same Review through Agents.
- Use a Samebase review to check that OAuth visits do not change the primary site.
  Start with a shorter review to validate navigation and discovery first.

## Still to decide through use

- Whether Scout profiles and email addresses should be visible without signing in.
- Whether members need a list of connected services on a profile, beyond public work.
- Whether “Other sites visited” helps users enough to deserve space in the UI.
- How to handle an explicit change of subject to a different product mid-conversation.

Defer payment changes, new agent orchestration, a product dependency graph, and
broader workspace infrastructure until this member flow gives us a concrete need.

## Relevant code and earlier notes

- `apps/scout/src/products/conversation/`: shared Play/Review interface.
- `apps/scout/src/components/product-home.tsx`: activity and starting points.
- `apps/scout/src/components/app-navigation.tsx`: role-based navigation.
- `apps/scout/src/routes/scouts.*`: existing management-oriented Scout pages.
- `apps/scout/convex/scout/activity.ts`: product conversation reads and activity feed.
- `apps/scout/convex/scout/chats.ts`: conversation creation and product metadata.
- `apps/scout/convex/agentsApi/`: Review runtime and admin inspection.
- `apps/scout/convex/schema.ts`: chat and workspace records.
- [Shared workspaces](workspaces.md) and [earlier product direction](play-product-direction.md).
  Those documents contain historical implementation and rollout notes; check current
  code before relying on their runtime or access descriptions.
