# Member experience

Discussion checkpoint: September 14, 2026. This records the direction and proposed
next work; it does not claim that the proposed experience is implemented. Continue
here or use this file to brief a new task.

## Aim

Make Scout useful and understandable to someone who is not an admin. Focus first
on completing an ordinary product review through the member interface, then use
what we learn to improve Play. Judge changes through actual product use, not more
speculative prompt edits.

## Direction from the discussion

- Keep one public activity feed with Play/Review filters and access to live and
  completed conversations. Private conversations stay out of public results.
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

- `/` provides public activity and My activity. `/play` and `/review` each provide
  their starting composer and conversation on the same route.
- Activity type and visibility use shadcn Select controls. Rows distinguish Play
  and Review with their existing icons and small yellow or emerald badges.
- Review uses the OpenAI Agents API; Play still uses the Convex Agent. This product
  work does not require unifying or replacing those runtimes.
- `scoutChats` stores purpose, visibility, owner, Scout, and runtime. It has no
  primary-site relationship. Titles currently come from the first request.
- `scoutWorkspaces` distinguishes chat and site workspaces. A site workspace is
  shared knowledge keyed by exact hostname, not a product catalog or a chat subject.
- Approved members can open Scouts from the main navigation and browse names,
  emails, and profiles through `access_scout_view`. Registration, provider resources,
  service accounts, and credential controls remain admin-only. Profiles do not yet
  show live availability or a Scout's public activity.
- PR #99 adds admin inspection of member-created Reviews in Agents. Its changes
  are separate from this proposed member experience.

## Proposed first experience

1. A visitor opens a public review and sees what was requested, which site it is
   about, the Scout's observations, and the live browser or recording.
2. A member opens a Scout profile to see its name, availability, and public work.
   The Scout-owned email address can be shown as part of its identity. Whether
   signed-out visitors also see profiles and email addresses is still undecided.
3. The member starts a Review with a normal request, such as “What is this site?
   Try its main feature and tell me whether it works.” Keep the current private
   default and explicit choice to publish.
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

The first slice adds member access to the existing Scout directory and profiles.
Next, try conversation titles, primary-site metadata, and the existing feed's site
filter, with links from conversation identities. Verify this whole path as an
approved member before expanding it.

Use recorded browser navigation for an optional “Other sites visited” view; it is
evidence of a visit, not a permanent dependency relationship. A site can have
conversations even if no shared workspace has been created. Later, the Sites page
can bring together conversations and shared knowledge, with access appropriate to
each. Do not make a workspace a prerequisite for starting or finding a review.

## Testing setup

Keep product development on the primary checkout at `http://localhost:5173`, using
the existing development deployment. Use Chrome for the admin and the in-app
browser for an approved member, both against that same backend. Start work through
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
stored locally in the ignored `apps/scout/.env.member-test.local` file. Chrome keeps
the admin login; the in-app browser uses this approved member. Settings shows the
signed-in email so that each browser's identity is visible.

## Verification for that first slice

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
