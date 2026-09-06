# Account approval: Samebase findings

Researched September 6, 2026 in `/Users/nicu/dev/samebase/samebase`, commit
`be38438b9aafe08fe320f4ee97c871c031498022`. This is a source review, not an inspection of
production configuration or account records. The [Scout RFC](./access-control-rfc.md)
defines what we implement.

## What Samebase does

Samebase deliberately allows authentication before approval. Its current
[admission spec][admission] supersedes the earlier pre-login allowlist: operators need
a real signed-in account to inspect and approve. A pending account is distinct from
an anonymous visitor and from an approved member.

| Boundary              | Verified behavior                                                                                                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account creation      | [OAuth creation][creation] writes `users.isApproved` from `AUTO_APPROVE_NEW_USERS === "true"`. Unset or false means unapproved. Existing identities return their existing user record and retain its approval.                                                               |
| Password provisioning | The [internal password admin action][password-admin] creates verified, approved accounts and checks the expected linked identity before approving an existing one. This is trusted operator provisioning, not a public signup approval parameter.                            |
| Stored state          | [User lifecycle schema][lifecycle] has optional `isApproved`; the effective-role resolver treats missing or false as pending. Deleting accounts have their own state.                                                                                                        |
| Effective access      | The [role resolver][role] returns `role_pending_access` for an ordinary unapproved user. Approved users pass through a separate Terms gate before becoming members. Staff email authority is a separate Samebase rule.                                                       |
| Permissions           | The [shared grants][grants] let pending users use account settings, deletion, preferences, and invitation acceptance. App operations require member/staff grants, enforced by backend builders. Signing in alone does not grant them.                                        |
| Waiting screen        | [ApprovalGate][gate] waits for the reactive viewer query before mounting protected children. Pending users see an access-pending page and can sign out. The [sidebar][sidebar] explains manual approval and automatic page updates.                                          |
| Manual administration | The admission spec describes changing `users.isApproved` in data. The current [admin users page][admin-ui] displays Approved/Pending but contains no approval button. We did not find a public approval mutation or a Contacts-specific approval interface in this checkout. |
| Invitation exception  | [Organization invitation acceptance][invitations] verifies the exact invited GitHub identity, expiry, and capacity, then approves the user in the same transaction as membership creation.                                                                                   |
| Tests                 | [Account-linking tests][creation-tests] cover auto-approval enabled, disabled, and unset. [Lifecycle tests][lifecycle-tests] cover pending/member/staff/Terms/deleting roles and denial of protected operations to pending users.                                            |

Current code and the implemented admission spec take precedence over the older access
RFC's `role_waitlisted` wording. Neither an environment override nor successful login
should be mistaken for the ordinary unapproved default.

## What Scout adopts

Scout stores `isApproved` beside its role and suspension status directly on `users`,
matching Samebase. Missing approval is treated as false. Public password signup starts as an active, unapproved member. Email
verification establishes identity; admin approval grants application permissions.
Login, verification, and password recovery never approve or promote an existing account.

The existing Members page gets explicit Approve/Revoke approval controls. A verified,
active, approved admin can use them; approval changes receive the same transactional
audit and last-admin protection as role and suspension changes. This supplies a safer
normal workflow than raw database edits, which bypass those invariants and cleanup.
The one-time internal admin bootstrap explicitly approves its verified target.

Pending users retain account/session controls and see a waiting state that updates
through the viewer subscription. Backend guards derive permissions from current
approval as well as role/status. Revoking approval also invokes existing Lab cleanup.

Scout does not adopt Samebase's staff email allowlist, automatic-approval environment
flag, Terms gate, organization memberships, or invitation approval exception. There is
no need for those concepts in this stage. Signup explicitly writes the defaults. Optional user
fields support Convex Auth's insert lifecycle and retained users without granting access.

Approval does not assign either existing Scout, create a Scout, or determine ownership.
Approved members can enter Play and Review, while Play execution remains unavailable
until its resource policy is decided and implemented. Lab remains admin-only.

[admission]: https://github.com/samebase/samebase/blob/be38438b9aafe08fe320f4ee97c871c031498022/specs/018_AUTH_ALLOWLIST_PRELOGIN_ENFORCEMENT_SPEC.md
[creation]: https://github.com/samebase/samebase/blob/be38438b9aafe08fe320f4ee97c871c031498022/apps/samebase/convex/identity/accountLinking.ts#L235
[password-admin]: https://github.com/samebase/samebase/blob/be38438b9aafe08fe320f4ee97c871c031498022/apps/samebase/convex/authAdmin.ts
[lifecycle]: https://github.com/samebase/samebase/blob/be38438b9aafe08fe320f4ee97c871c031498022/apps/samebase/convex/identity/lifecycle.ts
[role]: https://github.com/samebase/samebase/blob/be38438b9aafe08fe320f4ee97c871c031498022/apps/samebase/convex/identity/viewerRole.ts
[grants]: https://github.com/samebase/samebase/blob/be38438b9aafe08fe320f4ee97c871c031498022/apps/samebase/shared/accessModel.ts
[gate]: https://github.com/samebase/samebase/blob/be38438b9aafe08fe320f4ee97c871c031498022/apps/samebase/src/components/ApprovalGate.tsx
[sidebar]: https://github.com/samebase/samebase/blob/be38438b9aafe08fe320f4ee97c871c031498022/apps/samebase/src/components/AppRightSidebar.tsx#L277
[admin-ui]: https://github.com/samebase/samebase/blob/be38438b9aafe08fe320f4ee97c871c031498022/apps/samebase/src/components/AdminUsersPage.tsx
[invitations]: https://github.com/samebase/samebase/blob/be38438b9aafe08fe320f4ee97c871c031498022/apps/samebase/convex/organizationMembers.ts#L787
[creation-tests]: https://github.com/samebase/samebase/blob/be38438b9aafe08fe320f4ee97c871c031498022/apps/samebase/convex/identity/accountLinking.convex.test.ts
[lifecycle-tests]: https://github.com/samebase/samebase/blob/be38438b9aafe08fe320f4ee97c871c031498022/apps/samebase/convex/identity/lifecycle.convex.test.ts
