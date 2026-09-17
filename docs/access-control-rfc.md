# Account approval and derived access

Status: implementation contract, September 7, 2026. This replaces the stored-role
account design from PR #72. [Samebase source notes](./account-approval-research.md) record
the reference behavior and Scout-specific differences.

## Database contract

Account authorization adds one field to Convex Auth's `users` document:
`isApproved: v.optional(v.boolean())`. For ordinary users, only `true` grants member
access; `false` and a missing field both mean pending approval. Convex Auth continues
to own identity, email verification, passwords, and sessions.

There are no persisted `users.role` or `users.status` fields, and no `accountAccess` or
`accountAccessAudit` tables in the schema. Roles and permission keys are derived for
viewer responses, never stored. There are no promotion, suspension, admin-bootstrap,
last-admin protection, audit, or account-revocation workflows.

Public signup writes `isApproved: false`. Email verification enables sign-in without approving
the account. Login and password recovery preserve approval; client-supplied approval or
role fields are ignored.

## Derived permissions

Scout requires a verified email before granting protected app access. For a verified user,
staff authority comes from Scout's allowlist, matched case-insensitively:
`nicu.dev@gmail.com` and `nicu@samebase.com`. It does not depend on `isApproved`.

| Verified account                           | Derived role          | Access                                                                              |
| ------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------- |
| Allowlisted email, with any approval value | `role_staff`          | Account controls, Play/Review entry, Lab, Scout management, Members administration. |
| Other email, `isApproved: true`            | `role_member`         | Account controls, Play/Review entry, Scout profiles and service-account viewing.    |
| Other email, approval false or missing     | `role_pending_access` | Public pages and own account/session controls.                                      |

Public application Convex functions declare named access keys through the shared builders.
Backend and runtime checks read the current user; route gates and navigation use the
reactive viewer response. Approval changes take effect without signing in again.
Auth-library exports and public bearer-token handoffs retain their protocol boundaries.

Admin authority does not bypass private-thread ownership. Shared Scout activity returns
only `busy` when another account owns the active chat; the owner retains details and links
between their own chats.

## Scout-specific scope

Scout keeps `/members` as a staff-only convenience for listing users and changing approval.
Its Approve/Revoke controls write `users.isApproved`, exactly as a Convex dashboard edit
does. The Samebase reference uses data administration rather than an approval control on
its users page. Approval can be set before verification, but access still requires a
verified email. Revoking approval does not remove allowlisted staff authority or schedule
a cleanup workflow.

Scout does not add Samebase's Terms gate, organization or invitation approval rules,
or automatic public-signup approval setting. Self-service deletion is specified
separately in the [account deletion contract](./account-deletion-rfc.md); deleting and
deleted accounts have no protected app access.

Approved members can start and control their own Play and Review chats using available shared Scouts.
Execution rechecks the chat owner's current product permission; general Lab chats still require
Lab access. Public viewers receive conversation text and read-only browser views or replay.
Private chats remain owner-only, and publishing requires current product permission. Owners can
make a chat private even after approval is revoked. Scout inboxes, profiles, credentials, workspace
files, and raw model/tool data are not part of the public viewing API.
Only staff owners can open a chat's detailed Lab inspector. Signup and approval neither create
nor assign a Scout, browser, inbox, or connected account.

## Development and rollout

The guarded development seed creates or updates a verified, approved password account.
It is a member unless its email is allowlisted; seeding never grants a stored admin role.

If retained production approvals from PR #72 are needed, manually copy each relevant
`accountAccess.isApproved` value to the matching `users.isApproved` using `userId`.
Removing a table from the schema does not copy its data. The application does not read
old access rows, and there is no permanent migration helper. Do not copy roles, status,
or audit records; staff authority follows the allowlist. Missing approval remains denied
for ordinary users until it is set.

`scripts/deploy-cloudflare.ts` is restored unchanged from v181 (`77d21bf`). This account
change adds no deployment automation or replacement for the removed auth-origin setup.
