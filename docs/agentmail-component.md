# AgentMail component installation

Scout references the fork branch
[`samebase/agentmail-convex#fix-component-configuration`](https://github.com/samebase/agentmail-convex/tree/fix-component-configuration).
The lockfile resolves it to commit
[`cad8891`](https://github.com/samebase/agentmail-convex/commit/cad8891566e05b8ffcc06747992898fdd3c2cad1).
There is no pnpm patch.

The component is mounted in `convex/convex.config.ts`, which binds Scout's
`AGENTMAIL_API_KEY` and optional `AGENTMAIL_BASE_URL` into the component.
The component reads these through its generated, typed `env` export.
Existing Scout email tools have not been migrated yet.

## Install

The fork's `prepare` script runs its existing build before the Git dependency
is packaged. This includes `dist/` in the installed package automatically.
Scout permits this build in `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  "@agentmail/convex": true
```

Run the normal installation from Scout:

```text
pnpm install --frozen-lockfile
```

To resolve a newer commit on the fork branch, run
`pnpm update @agentmail/convex --latest` and commit the updated lockfile.
No separate checkout, manual build, or copying into `node_modules` is needed.

## Verify on a development deployment

Select a separate development deployment for this worktree, then run:

```text
pnpm run check
pnpm exec convex dev --once --typecheck enable
pnpm exec convex run agentMailComponent:verifyConnection '{}'
```

The internal check verifies that Scout has its API key and calls the component's
`listInboxes` with `limit: 1`. Success returns `null`. It does not return
credentials or inbox contents, send email, or create an inbox.

On September 10, 2026, fork commit `41fe87b` built automatically during Scout's
dependency installation. Scout's checks and full build passed, with 657 tests
passing and three skipped. It deployed to the dedicated dev
`nicu:scout:dev/agentmail-component` (`earnest-fox-412`), and the connection
check succeeded against the real AgentMail API.

Sending, inbound webhooks, historical imports, and migration of Scout's email
tools remain untested by this connection check.

## Pending tool migration

The component is installed and verified, but the agents still use the existing
email tools. The next change is to use its existing `listThreads` and
`getThread` methods for checking recent mail and reading login codes.

The Scout-to-inbox mapping stays in `scouts.agentMail`. This read-tool switch
does not require historical imports, new component search methods, or another
mailbox table. Sending, replies, and human-help delivery remain on their
current implementation during that first migration.

After rebasing onto `origin/main` at `811ed56`, `vp install --frozen-lockfile`
and `pnpm run check` passed: 679 tests passed and three were skipped.
