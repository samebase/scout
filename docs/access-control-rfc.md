# Account roles and approval, first stage

Status: implemented and available in PR #72's branch preview, September 6, 2026. Production unchanged.

Give Scout accounts a stored role and enforce named permissions in the backend and UI.
Allow signup with admin approval required for product access. Leave the relationship
between accounts and Scouts undecided.
This RFC is the implementation contract; [the research](./access-control-research.md)
records the evidence and earlier options. [Approval research](./account-approval-research.md)
traces Samebase’s current signup, pending access, and manual approval behavior.

## Account contract

- Convex Auth continues to own identity, verification, passwords, and sessions.
- One `accountAccess` row per user stores `role_member | role_admin` and
  `active | suspended`, and required `isApproved: boolean`. New accounts start as active,
  unapproved members. Email verification does not approve an account.
- Roles grant permissions through one shared map. The account model contains no Scout,
  workspace, organization, browser, or credential ownership fields. Unapproved or suspended
  accounts receive only public and account/session permissions, regardless of stored role.
- No email address confers runtime authority. Remove the admission email allowlist so
  anyone can create and verify an account. Client-supplied role/approval fields are ignored.
- A trusted internal bootstrap approves and promotes the first verified admin. It is explicit and
  idempotent, with a persisted event preventing a different account from repeating it.
  Bootstrap initializes its target when needed; login never silently promotes an account.
- Admins can approve verified accounts, revoke approval, change roles, and suspend accounts.
  Changes are transactional, audited, and cannot remove the last active, approved, verified admin. Promotion requires approval;
  approval alone never changes the role. Login and password recovery preserve all assignments.
- A missing user, missing access row, or unverified account gets no protected access.

## Permission contract

The role grants below apply only after approval while the account is active. Public
product previews stay public. Pending accounts see an approval message on Settings and
when attempting protected access; approval updates the page without another login.

| Permission              | Member | Admin | Current use                                                             |
| ----------------------- | ------ | ----- | ----------------------------------------------------------------------- |
| `access_public`         | Yes    | Yes   | Public pages and narrowly scoped handoff links.                         |
| `access_account`        | Yes    | Yes   | Own account/session controls, also while pending or suspended.          |
| `access_play`           | Yes    | Yes   | Play entry, with execution unavailable to members for now.              |
| `access_review`         | Yes    | Yes   | Review product entry; it remains a preview.                             |
| `access_lab`            | No     | Yes   | Existing chats, manual tools, browser views, replay, model diagnostics. |
| `access_scout_manage`   | No     | Yes   | Existing Scout registry and connected-account setup.                    |
| `access_members_manage` | No     | Yes   | Account list, approval, roles, suspension.                              |

All public application Convex functions declare an access policy through app-owned
builders. Auth library exports and public bearer-token handoffs keep their distinct
protocol boundaries. Internal work reloads the stored actor's current permission.
Thread ownership checks still apply to admins. Admin status does not grant access to
someone else's private thread.

The frontend reads one reactive viewer query. Restricted routes and navigation use the
same permission keys. Restricted children do not mount before access resolves, and
unmount when access is lost. Personal settings use neutral session copy.

## Existing Scouts and products

Do not add Scout ownership, assign either existing Scout to a member, create a Scout
at signup, or change provider profiles. Those choices require a later product decision.
The existing Play execution still uses Lab APIs and therefore stays admin-only.
Members see an unavailable state without querying the Scout registry or chat APIs.
Review stays a public preview, with its Lab link visible only to permitted accounts.

## Revocation

New API calls, generation steps, tools, and handoff claims check current permissions.
Demotion, suspension, or approval revocation schedules bounded cleanup of the user’s
existing chats. Cleanup stops turns, expires handoffs, and closes browsers through the existing lifecycle.
Cleanup remains authorized internally after user access is removed.

Provider operations already dispatched can finish. Downloaded recordings and issued
provider URLs cannot be recalled by a database permission change. Do not claim otherwise.

## Implementation order

1. Shared role/permission schema, account storage, auth initialization, and explicit bootstrap.
2. Public function builders and classification of existing APIs; internal runtime rechecks.
3. Account administration, audit, last-admin protection, and revocation cleanup.
4. Reactive route/navigation gates, member product states, and account administration UI.
5. Focused backend/UI tests, complete project checks, and an isolated local backend/browser check.

Use the isolated worktree deployment for account-state tests; preserve real preview accounts and
Scouts. A retained deployment needs its existing accounts initialized and a verified user
bootstrapped before normal admin access works. Use the rollout procedure below.

## Acceptance

- New signup defaults to unapproved member; repeat auth flows preserve existing assignments.
- A member cannot call Lab or admin APIs, even with a known Scout or owned thread ID.
- A second admin cannot read another user's thread.
- Member Play renders no registry, chat, browser, or model-data queries.
- Approval/role/status changes take effect without signing in again; handoff tokens do not bypass revocation.
- Concurrent revocations cannot remove every active approved admin; repeat updates do not duplicate audit events.
- Signup/verification cannot self-approve or grant admin; bootstrapped admin sign-in, Lab APIs, and development seeding continue to work.
- No Scout provisioning or ownership model is introduced.

## Rollout and evidence

For an isolated worktree, `pnpm run dev` creates the local backend and explicitly bootstraps
its seeded verified development account. Repeating the seed preserves subsequent role changes.
Both stages are published together in the branch preview. The earlier local role experiment’s disposable `accountAccess` and
`accountAccessAudit` fixtures were reset before adding the required approval field; users
and auth sessions were retained. Do not use that reset for retained or production data.

For a retained deployment, select that deployment in the Convex dashboard before running
internal functions. Inspect the existing `users` records and select the intended verified
administrator by user ID. Run `accounts:bootstrapAdmin` with:

```json
{ "userId": "<verified-user-id>" }
```

The mutation initializes the account if needed and records the one-time bootstrap. Run
`accounts:initialize` with the same argument shape for each additional existing user;
it creates an active, unapproved member only when an access record is missing. Then use
`/members` to approve access and separately assign roles or suspend accounts. Ordinary
clients cannot call these internal bootstrap functions.
Use the Members controls for ongoing administration. Direct database edits bypass audit,
last-admin protection, and proactive revocation cleanup. Runtime guards still read current data.

Revocation closes browsers through a workflow with three attempts. If all attempts fail,
server access remains blocked; the failed revocation workflow remains available
for operator inspection. An operator can retry the internal
`humanHandoffBrowser:finishBrowserSession` with the affected `sessionId` and
`captureEvidence: false`. Previously dispatched provider operations can still finish.
Existing handoff/turn cleanup also retains its own failure reporting.

Verification covers public signup and email verification, forged signup fields, development
bootstrap, repeated initialization, approval/promotion/demotion/suspension, audit idempotency,
competing last-admin demotions and approval revocations, direct API denial, private thread
ownership, live route changes, member Play query suppression, revoked handoff links, and
cleanup retry. Login and password recovery preserve both approval states and suspension.
Provider operations and outbound email are mocked in tests; no paid Scout run was started.

The first preview signup exposed a missing `SITE_URL` before email verification could start.
That preview setting was repaired. Preview uploads now set it from Wrangler's returned branch URL;
deployment tests cover missing metadata and failed setup. An auth regression test reproduces the
interrupted signup and verifies recovery through sign-in after configuration, still pending approval.

`pnpm run check` and `pnpm run build:app` passed: 478 tests passed, 3 pre-existing skips on the v181 base.
Browser checks used the local anonymous backend with disposable
accounts and confirmed approval through Members, last-approved-admin protection, removal
of an open admin page on revocation, retained Settings access, and automatic transition
from waiting to approved member without another login. Public navigation exposes signup
and the form explains approval before submission. The local seeded admin was restored
and the synthetic member returned to pending approval after verification.
