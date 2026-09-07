# Chat workspaces

Open **Workspace** in an existing chat to browse files, preview text, download a file, or run a
command. Scout's `bash` tool and the terminal use the same private workspace. Commands and their
results also appear in the conversation.

The workspace uses `view=workspace` on the chat URL, with `file` identifying the selected path.
Back and Forward restore the previous view or file; reloading a bookmark reopens the same preview.
Terminal visibility is also URL-backed, but command input and output history stay local.

This MVP uses `just-bash` inside a Convex Node action. It is an in-memory shell interpreter, not a
container or Linux VM. No separate sandbox service is needed. The command allowlist includes file
operations, pipes, redirects, `grep`, `sed`, `awk`, and `jq`. It excludes network access, Python,
JavaScript execution, package installation, native programs, and background services.

Only `/workspace` persists. Files, empty directories, symlinks, permissions, modification times,
and the working directory survive subsequent commands. Shell variables and files elsewhere do
not. Text previews are read-only and render HTML as text. Binary files can be downloaded.

## Connect R2

Use a private R2 bucket and an S3 credential with Object Read & Write access scoped to that bucket.
See [Cloudflare's R2 authentication instructions](https://developers.cloudflare.com/r2/api/tokens/).
The implementation uses the [official Convex R2 component](https://github.com/get-convex/r2).

Set these four variables in the intended Convex deployment's dashboard:

| Variable               | Value                                                                |
| ---------------------- | -------------------------------------------------------------------- |
| `R2_BUCKET`            | The private bucket name                                              |
| `R2_ENDPOINT`          | The bucket's S3 endpoint, including its jurisdiction when applicable |
| `R2_ACCESS_KEY_ID`     | The scoped S3 access key ID                                          |
| `R2_SECRET_ACCESS_KEY` | The scoped S3 secret access key                                      |

Do not put these credentials in `VITE_*` variables, the browser, Git, or chat messages. Production,
preview, and isolated local Convex deployments each need their own configuration. Prefer separate
production and development buckets and credentials. In local development, restart `pnpm run dev`
after changing credentials if the Node executor still sees the old configuration.

For automatic preview setup, add all four variables to the project's **Default Environment
Variables** with **Preview** selected. Select **Development** too if new cloud development
deployments should share the bucket. Defaults apply when a deployment is created; they do not
update existing deployments. Set those separately and leave **Production** unselected when using
development credentials.

Scout's private `scout-workspaces` bucket is configured for Development and Preview defaults and
the existing cloud development deployment. Production is not configured. The local workspace UI
has been verified against real R2 for file creation, preview, reload, rename, update, and cleanup.
An isolated cloud dev deployment has also passed an AI Gateway test that creates a file through
the agent's Bash tool and reads it back from R2. See [cloud worktree setup](./local-setup.md#cloud-backend-for-a-worktree)
to run the full agent instead of only the anonymous backend's manual terminal.

Uploads and text-preview reads happen server-side. Downloads use short-lived signed links. The
MVP needs neither a public bucket nor browser-upload CORS. Signed links grant access to the file
until they expire, so treat them as private.

## Where files live

Convex stores the directory listing, ownership binding, hashes, and current revision. R2 stores the
file bytes. An object key looks like:

```text
deployments/<deployment>/users/<user-id>/threads/<thread-id>/files/<upload-id>/reports/scores.csv
```

Names are URL-encoded by path segment. Each changed file gets a new upload ID, so a failed upload
cannot overwrite the currently saved bytes. Unchanged files reuse their existing object. A
successful commit schedules deletion of replaced or removed objects through the R2 component.

These keys preserve the user, chat, and file path if the Convex file table is lost. They do not
replace database backups: the bucket alone cannot reliably recover the latest committed revision,
empty directories, symlinks, or the mapping from a user ID to a person. Interrupted uploads or
conflicting commands can leave unreferenced objects. Automated orphan cleanup, snapshots, and a
recovery manifest are outside this MVP.

## Limits and failure behavior

- 200 entries, including directories and the workspace root.
- 256 KiB per file and 5 MiB of persisted file content per chat.
- 15 seconds of shell execution and 128 KiB of command output. Storage transfer adds time.
- Commands start from the latest saved workspace. A revision check rejects concurrent stale
  writes instead of overwriting another command's changes.
- A nonzero shell exit can still save earlier file changes, just like a normal shell. Size and
  integrity failures leave the previous workspace intact. If storage or a commit fails, inspect
  the workspace before retrying; the action does not claim those changes were saved.

Terminal history is local to the open panel; the chat transcript retains manual tool results.
There is no file-upload UI, rich editor, live process output, or automatic command retry.

## Verify

Run `pnpm run check`. `convex/scout/workspaceShell.test.ts` exercises shell behavior and limits;
`convex/workspaces.test.ts` exercises persistence, failed writes, stale commits, and owner-only
access with a stubbed R2 boundary. Chat component tests cover the terminal, safe preview,
missing-configuration state, and URL navigation through Back, Forward, and fresh page loads.

For a real-bucket smoke test, open a development chat and run:

```bash
mkdir -p reports/empty
cd reports
printf 'name,score\nAlpha,8\nBeta,9\n' > scores.csv
cat scores.csv
```

Preview and download the CSV, reload the page, then run `pwd; cat scores.csv`. Confirm the object
appears under the expected deployment/user/thread prefix in R2. Run `mv scores.csv final.csv` and
check that the file tree updates. Local object-store tests do not verify Cloudflare credentials,
R2 permissions, or real-provider behavior; this smoke test is required after connecting a bucket.
