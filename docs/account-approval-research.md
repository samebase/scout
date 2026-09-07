# Samebase account approval reference

Source: Samebase commit `be38438b9aafe08fe320f4ee97c871c031498022`, reviewed locally.
This note describes source behavior, not production records. The [Scout account
contract](./access-control-rfc.md) defines the current implementation.

Samebase stores optional `users.isApproved`; false or missing approval leaves an ordinary
account pending. Its [staff check][staff] compares the lowercase email against exactly
`nicuchiciuc@gmail.com` and `nicu@samebase.com`. The [viewer resolver][viewer] derives staff
authority independently of approval. It also applies Samebase's Terms and account-lifecycle
gates. These are derived roles, not stored user roles or a suspension field.

The [admission spec][admission] describes approval as setting `users.isApproved` in data.
The [admin users page][admin-ui] displays approval but has no approval button.

Scout adopts the optional approval field, email-derived staff permissions, and
reactive access updates. Its explicit differences are:

- Scout's staff emails are `nicu.dev@gmail.com` and `nicu@samebase.com`.
- A verified email is required before protected app access.
- `/members` provides approval controls that edit the same field as the Convex dashboard.
- Public signup remains unapproved; there is no automatic-approval setting.
- Terms, account deletion, organization memberships, and invitation approval are outside scope.
- Approved members get Play/Review entry; existing shared Scout execution stays in the admin Lab.

[staff]: https://github.com/samebase/samebase/blob/be38438b9aafe08fe320f4ee97c871c031498022/apps/samebase/convex/identity/access.ts
[viewer]: https://github.com/samebase/samebase/blob/be38438b9aafe08fe320f4ee97c871c031498022/apps/samebase/convex/identity/viewerRole.ts
[admission]: https://github.com/samebase/samebase/blob/be38438b9aafe08fe320f4ee97c871c031498022/specs/018_AUTH_ALLOWLIST_PRELOGIN_ENFORCEMENT_SPEC.md
[admin-ui]: https://github.com/samebase/samebase/blob/be38438b9aafe08fe320f4ee97c871c031498022/apps/samebase/src/components/AdminUsersPage.tsx
