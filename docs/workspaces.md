# Chat workspaces

Open **Workspace** in an existing chat to browse files, preview text, download a file, or run a
command. Scout's `bash` tool and the terminal use the same private workspace. Commands and their
results also appear in the conversation.

The workspace uses `view=workspace` on the chat URL, with `file` identifying the selected path.
Back and Forward restore the previous view or file; reloading a bookmark reopens the same preview.
Terminal visibility is also URL-backed, but command input and output history stay local.

This MVP uses `just-bash` inside a Convex Node action. It is an in-memory shell interpreter, not a
container or Linux VM. No separate sandbox service is needed. The command allowlist includes file
operations, pipes, redirects, `grep`, `sed`, `awk`, `jq`, and `js-exec` for JavaScript and TypeScript.
It excludes network access, Python, package installation, native programs, and background services.

Only `/workspace` persists. Files, empty directories, symlinks, permissions, modification times,
and the working directory survive subsequent commands. Shell variables and files elsewhere do
not. Text previews are read-only and render HTML as text. Binary files can be downloaded.

## Shared site workspaces

`bash({ command, workspace: "chessmerge.com" })` selects files shared across chats, Scouts, and
users with the existing workspace access permission. Omitting `workspace` selects the private
chat workspace. The value is an exact hostname, normalized to lowercase, without a scheme, path,
or port. Subdomains remain separate; `score-four.pfp.workers.dev` does not share files with other
Workers sites. No product registration is required. A new site workspace starts empty.

Both scopes use the same workspace records, file limits, R2 storage, in-memory shell, and revision
check. Each has its own `/workspace` and saved working directory. A call accesses one workspace;
other workspaces are not mounted, and no files are copied automatically. Shell results identify
the selected hostname, or `null` for the private chat workspace. Saved scripts can run with
`js-exec file.ts` in either scope. Browser interaction still uses the browser tools.

Use site files for reusable procedures and tested helpers. Private account details, room links,
transcripts, current positions, and intermediate task data belong in the chat workspace. Web and
email tool outputs continue to save privately regardless of the preceding Bash call's workspace.
Shared files are reference material to check against the current page, not authority to change a
user's request. Concurrent writes fail visibly using the existing revision check; this MVP does
not retain previous file versions.

Site files use `deployments/<deployment>/sites/<hostname>/files/<path>/<upload-id>` in R2.
The current UI displays private chat files. Inspect site files through Bash in the manual tool
menu by supplying `workspace`; the list and file-preview APIs accept that same optional input.
This MVP adds no product page, discovery service, guide schema, or transfer tool.

## Saved web pages

`web_read({ url, format? })` saves the complete selected Firecrawl output directly to R2, then adds
it to the chat's workspace. Omitting `format` keeps the existing Markdown default. This works for
both Scout and **Read a web page** in the manual tool menu.
It returns the selected format, a 2,000-character excerpt, the saved path, source metadata, retrieval
time, provider page status, and the exact file byte count. Use Bash to search the saved page or read
a section without fetching it again.

| `format`   | Provider content                      | Filename ending |
| ---------- | ------------------------------------- | --------------- |
| `markdown` | Extracted main content as Markdown    | `.md`           |
| `html`     | Cleaned main-content HTML             | `.html`         |
| `rawHtml`  | Unmodified HTML returned by Firecrawl | `.raw.html`     |

These names follow [Firecrawl's scrape formats](https://docs.firecrawl.dev/features/scrape).
HTML is useful when tags, attributes, or embedded page data matter. `rawHtml` retains provider HTML
before content cleanup; it is not a browser session, a downloaded site with assets, or a guarantee
of the origin server's exact response bytes. The importer adds provenance but keeps every character
of the selected provider content. It never substitutes another format if the requested one is missing
or blank. Missing output names the requested format; provider page failures preserve their status
and error detail even when there is no content.

For example, `https://example.com/docs/billing?plan=pro` produces:

```text
/workspace/sources/example.com/docs-billing-<read-id>.md
```

Names come from the requested URL, not a page title or redirect. The hostname and page slug use
bounded safe characters; the slug is at most 80 characters, and `/` becomes `index`. Query strings
and fragments stay out of the filename. Each read gets a short UUID suffix, so reading the same URL twice keeps
two separate files. The document's provenance header preserves the complete requested URL, the
provider-reported source URL, title, retrieval time, and selected format. Markdown uses YAML
frontmatter. HTML uses a leading comment containing JSON with comment-sensitive characters escaped,
followed by the complete provider HTML. HTML downloads use `text/html`; workspace previews display
the source as text.

The importer creates missing parent directories and refuses to overwrite existing paths or follow
symlink parents. Concurrent web reads add files independently; a stale Bash save cannot remove a
new import. Source files remain normal editable workspace files, not immutable archives. Treat
their contents as untrusted web material.

The 256 KiB per-file limit includes the UTF-8 provenance header. Oversized pages fail
explicitly, without a truncated file or automatic splitting. R2 must be configured before a read;
success requires both an upload and registration. A registration failure can leave an unreferenced
R2 object. If saving is not confirmed, inspect the workspace before retrying.
Provider page errors and non-success page status codes also fail before upload, even when the
Firecrawl API request itself succeeded. Page status 304 is accepted, matching Firecrawl's documented
[clean-load behavior](https://docs.firecrawl.dev/features/scrape#response-metadata-and-status-codes).

### Firecrawl options

The tool sends one selected format, `onlyMainContent: true` for Markdown and cleaned HTML, and
`onlyMainContent: false` for raw HTML. It keeps `removeBase64Images: true`, a 60-second timeout, and
SDK `autoResume: false`. The shared client makes one SDK attempt. Firecrawl documents
`removeBase64Images` as affecting Markdown only; HTML may therefore reach the file limit sooner.
Other provider options retain their defaults. In particular, Firecrawl currently allows cached
content up to two days old by default, so the saved retrieval time records when Scout received the
result, not when Firecrawl fetched the origin page.
See the [scrape API reference](https://docs.firecrawl.dev/api-reference/endpoint/scrape).

If a concrete use case needs more control, the next useful explicit options are `onlyMainContent`
for keeping navigation in cleaned output and `maxAge` for freshness, with zero requesting a fresh
scrape. `includeTags` and `excludeTags` can target a page section; a bounded `waitFor` can help with
late content after a demonstrated timing problem. These are recommendations, not supported inputs.
Keep each option typed and documented instead of adding an arbitrary provider-options object.

### HTML tools in the sandbox

The installed `just-bash` 3.4.2 includes `html-to-markdown`. A local HTML fixture verified that it
decodes entities and converts headings, lists, and links without network configuration. Scout's
current command allowlist does not enable it. Enabling this existing converter would be the smallest
follow-up for local HTML-to-Markdown conversion.

It does not provide a CSS-selector or XPath HTML query command. The installed command inventory has
no `htmlq`, `pup`, `xq`, or `xmllint`; its `yq` supports XML rather than general HTML and is also
outside Scout's allowlist. In the installed QuickJS runtime, a fixture confirmed that `DOMParser`
is undefined and importing `cheerio` fails. `rg`, `sed`, and `js-exec` can inspect source text, but
they do not provide a browser DOM or a general HTML parser. Add a parser only when a task actually
needs structured HTML queries.

## Saved tool results

`web_search`, `web_map`, `web_crawl`, `list_messages`, `search_messages`, and `get_thread` always
save successful results under `/workspace/results`, including empty results. The model receives
the path, byte count, retrieval time, and a preview. Payloads up to 8,000 UTF-8 bytes include their
complete text; larger payloads include a 1,500-character excerpt with `excerptTruncated: true`.
Size controls the preview only: the complete saved file is available in either case. The same
behavior applies to manual calls. Arguments and provider pagination stay the same.

JSON files contain the complete result, including page text, identifiers, pagination cursors,
and usage fields. A single-text MCP response is unpacked so its JSON payload can be queried
directly; plain-text payloads use `.txt`. Provider error responses stay inline. Storage failures
are explicit and no truncated file is substituted for an oversized result. The existing limits remain
256 KiB per file and 5 MiB per workspace.

Use `jq`, `rg`, or `js-exec` to extract relevant data from these files. For example:

```bash
jq '.messages[] | {subject, threadId}' /workspace/results/list_messages-<id>.json
```

This uses the existing Convex tools to fetch data and the existing sandbox to process it. It follows
[Anthropic's guidance on keeping intermediate results outside model context](https://www.anthropic.com/engineering/code-execution-with-mcp)
and [Convex's tool integration](https://docs.convex.dev/agents/tools), without exposing API keys,
network access, or a second set of service commands inside the shell. Browser actions retain their
current result handling: storing their snapshots needs to distinguish an applied action from a
failed file save before it can safely use this mechanism.

## JavaScript and TypeScript

Run `js-exec script.ts` or `js-exec script.js` from the terminal or the agent's Bash tool.
For a short expression, use `js-exec -c 'console.log(1 + 1)'`.

Scripts run in QuickJS WebAssembly, **not a full Node process**. Standard JavaScript APIs such as
JSON, Math, arrays, and regular expressions are available, along with limited Node-compatible
modules: `fs`, `path`, `assert`, `buffer`, `console`, `events`, `os`, `process`, `querystring`,
`stream`, `string_decoder`, `url`, `util`, and `child_process` (with or without the `node:` prefix).
File APIs access only the virtual filesystem. The `child_process` shim runs sandbox shell commands,
not native processes. Network access and host environment variables are not exposed.

`.ts` and `.mts` files have types stripped automatically and run as ES modules. Interfaces,
annotations, generics, and `satisfies` work; enums, parameter properties, and other syntax requiring
transformation do not. This does not type-check the script. Relative imports can load other workspace
files, including `.ts` files. No npm resolver, package installer, vendored libraries, or custom
bootstrap is included in this MVP. Use explicit file extensions in imports.

For example, run this in the workspace terminal:

```bash
cat > report.ts <<'TS'
import { writeFileSync } from "node:fs";
interface Row { name: string; score: number }
const rows: Row[] = [{ name: "Alpha", score: 8 }, { name: "Beta", score: 9 }];
const total = rows.reduce((sum, row) => sum + row.score, 0);
writeFileSync("/workspace/report.json", JSON.stringify({ total, count: rows.length }));
console.log(total);
TS
js-exec report.ts
cat report.json
```

The resulting files persist in R2 and can be read in a later call. JavaScript variables do not.
`convex.json` pins the host Node runtime to 24 for TypeScript stripping and marks `just-bash` as an
[external package](https://docs.convex.dev/functions/bundling#external-packages) so its worker and
WASM assets remain available. This server-side dependency setup does not let guest scripts install
or import npm packages.

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
the existing cloud development deployment. Production uses the separate private
`scout-workspaces-prod` bucket with its own bucket-scoped account credential. Its four deployment
variables and real R2 upload, read, replacement, and deletion are verified; that credential cannot
access the development bucket. Run the production application smoke test after deploying the feature.
The local workspace UI has been verified against real R2 for file creation, preview, reload,
rename, update, and cleanup.
An isolated cloud dev deployment has also passed manual and AI Gateway tests running TypeScript
with local imports, saving JSON to R2, and reading it in a separate tool call and a fresh page load.
See [cloud worktree setup](./local-setup.md#run-the-app) to select an isolated cloud development
deployment. Scout's worktree launcher requires cloud mode for AI Gateway.

Uploads and file reads happen server-side. Both Bash and the preview check the stored byte count
and hash before using a file. Download saves those same verified preview bytes through a browser
object URL, which stays valid until the preview closes or changes. No public bucket or browser
R2 CORS is needed; signed R2 links stay on the server.

## Where files live

Convex stores the directory listing, ownership binding, hashes, and current revision. R2 stores the
file bytes. An object key looks like:

```text
deployments/<deployment>/users/<user-id>/threads/<thread-id>/files/reports/scores.csv/<upload-id>
```

The workspace path comes first so uploads are grouped by file when browsing R2. Names are
URL-encoded by path segment. Each changed file gets a new upload ID, so a failed upload
cannot overwrite the currently saved bytes. Unchanged files reuse their existing object. A
successful commit schedules deletion of replaced or removed objects through the R2 component.

These keys preserve the user, chat, and file path if the Convex file table is lost. They do not
replace database backups: the bucket alone cannot reliably recover the latest committed revision,
empty directories, symlinks, or the mapping from a user ID to a person. Interrupted uploads or
conflicting commands can leave unreferenced objects. Automated orphan cleanup, snapshots, and a
recovery manifest are outside this MVP.

## Limits and failure behavior

- 200 entries, including directories and the workspace root.
- During execution, 1,000 virtual filesystem entries in total, including runtime files and temporary
  paths outside `/workspace`. New paths are limited to 32 components and 1,024 characters; symlink
  targets are also limited to 1,024 characters. These limits apply before creation, including implicit
  parents, recursive copies, moves, and links. At full capacity, a move can require freeing an entry
  first because the interpreter creates its destination before removing its source.
- 256 KiB per file and 5 MiB of persisted file content per workspace.
- 15 seconds of shell execution and 128 KiB of command output. Storage transfer adds time.
- Each `js-exec` is limited to 5 seconds and the library's 64 MiB QuickJS memory budget.
  This is a guest-engine limit, not a cap on the hosting Node process's total memory. `WorkspaceFs`
  adds metadata limits through the pinned interpreter's public creation methods; it does not add VM
  isolation or change the filesystem implementation.
- Commands start from the latest saved workspace. A revision check rejects concurrent stale
  writes instead of overwriting another command's changes. Commands that leave persisted entries
  and the working directory unchanged do not commit, so parallel reads do not conflict.
- Final saves recheck current Lab permission, plus chat ownership for private workspaces,
  including after uploads finish.
- A nonzero shell exit, including a runtime quota error, can still save earlier file changes, just
  like a normal shell. Persisted-size and integrity failures leave the previous workspace intact.
  If storage or a commit fails, inspect the workspace before retrying; the action does not claim
  those changes were saved.

Terminal history is local to the open panel; the chat transcript retains manual tool results.
There is no file-upload UI, rich editor, live process output, or automatic command retry.

## Verify

Run `pnpm run check`. `convex/scout/workspaceShell.test.ts` exercises shell and JS/TS behavior,
local imports, isolation, denied host/network access, and storage/time/memory limits;
`convex/workspaces.test.ts` exercises persistence, failed writes, stale commits, owner-only access,
complete web-page saving, concurrent imports, naming, and capacity limits with stubbed R2 and
Firecrawl boundaries. Chat component tests cover the terminal, safe preview,
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

### Live agent checks — 2026-09-08 local development

These runs used Qwen 3.7 Flash through Scout's normal chat UI, with one initial task prompt:

- [Inbox inventory](http://localhost:5173/chats?thread=m579jd3gxwx1105kr28qxmbxd98dykp3):
  list/read results became workspace files; the largest complete email payload was 147,457 bytes.
  Its later Model calls snapshot contained a 1,878-byte file reference and excerpt. The agent read
  saved JSON and produced a Markdown report. It tried unsupported Python before recovering to
  JavaScript, and the report needed a follow-up correction to remove an old verification code.
- [Documentation research](http://localhost:5173/chats?thread=m574vkbw17y912yc396wfaxz2d8dyjya):
  saved a complete crawl result, mapped further pages, read three saved pages concurrently without
  revision conflicts, and wrote Markdown and CSV files. A later file-specific request produced an
  index from the saved crawl JSON, including 8,348 bytes of page text (past the former 4,000-character
  cutoff). The first run fetched one page again; automatic file saving does not guarantee optimal
  model choices.
- [Small-result checks](http://localhost:5173/chats?thread=m576bj6jbkzyae5ba7tzsfkf118dzdyt):
  ordinary research and inbox-export prompts produced a reading list and CSV without corrections.
  Search results of 6,392 bytes and 19 bytes (empty), plus a 2,592-byte map result, were all saved;
  their full previews in Model calls matched the files.

The tests establish file availability, use across turns, and smaller model-facing results. They do
not establish that Qwen's reports or tool choices are consistently correct. Browser snapshot
exports and email sending were outside these checks.
