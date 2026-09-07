# Delete an account, retain Scout history

Status: implementation contract, September 7, 2026.

Accounts grant access to shared Scouts. Deleting an account keeps its chats,
messages, attachments, browser history, and shared Scout service accounts.
Chat visibility remains governed by the existing permissions.

Settings links to `/account-deletion`. The user types `delete my account`.
Pending members, approved members, and admins can delete only their own account.
Deletion starts immediately, blocks app access and new sign-ins, stops the user's
active Lab work, and removes authentication records. The initiating browser can
see progress and retry a failed cleanup. Success signs it out. There is no undo.

The `users` schema adds a lifecycle union: normal accounts, `state: "deleting"`
with a cleanup workflow ID, and `state: "deleted"` with `deletedAt`. Existing
normal rows may omit `state`; signup writes `active`. Deleted rows keep only
Convex's ID/creation time and the deleted state/time. Profile and approval fields
are removed. References in retained history resolve to "Deleted account".
Approval and admin rules stay independent of this lifecycle.

Use the existing Workflow component. Add no account-deletion tables, permanent
deletion logs, waiting period, restoration flow, organization model, or deployment
automation. Add a session index to the existing auth verifier table for cleanup.

Samebase reference: commit `be38438b9`, `apps/samebase/convex/accountDeletion/`,
`convex/identity/lifecycle.ts`, and `src/account/AccountDeletionDialog.tsx`.
Reuse its typed confirmation, session-derived target, bounded auth cleanup, and
scrubbed user record. Scout deliberately starts immediately and permits staff
self-deletion. Keep the retention explanation on the deletion screen; a full
Terms/Privacy system is outside this hackathon change.

Verify self-only access, pending/admin deletion, immediate access revocation,
auth cleanup across batches, retry, retained chat/file/Scout data, and sign-out.
