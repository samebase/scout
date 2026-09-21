<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Workspace

- `apps/scout/` contains the frontend, Convex backend, shared app code, and app scripts.
- Root `vite.config.ts` owns formatting, lint rules, staged checks, and workspace test discovery.
  Each app or package owns its own build and runtime configuration.
- Run the supported `pnpm run` commands from the repository root. To run a Convex command,
  use `pnpm --filter samebase-scout exec convex <command>`.
- App environment files, including `.env.local`, belong in `apps/scout/`.
- Add deployable services under `apps/` and shared libraries under `packages/`.

## Startup

- Install Vite+ once to supply Node.js, then run `corepack enable` to make pnpm available.
- Use `pnpm run dev` for normal development. It selects the primary or linked-worktree flow.
- Reserve frontend port `5173` for the primary checkout. Linked worktrees start at `5174` and
  use a higher available port when needed.
- Vite+ stays in `package.json` and supplies the dev, format, lint, test, and build tools behind the
  package scripts.

## Hackathon scope

- This app is pre-user hackathon software. Do not preserve legacy routes, schema fields, or
  backward-compatible code paths for disposable development data unless the user explicitly asks.
- Prefer the simpler current design and a targeted development-data reset over migration scaffolding.
  Never apply this shortcut to production or user data without explicit authorization.

## About and submission copy

- Keep the About page as hand-written JSX in `apps/scout/src/routes/about.tsx` so its HTML and
  layout can be edited directly.
- Keep its product story, capabilities, technical explanation, and shared links synchronized with
  `docs/hackathon-submission.md`. When changing that content in either file, update the other in
  the same change. Verify feature claims against the implementation before adding them to either.
- Presentation can differ between JSX and Markdown. A layout-only or formatting-only change does
  not require a matching edit to the other file.
- Do not add automatic Markdown rendering, content extraction, or generation between these files
  unless the user asks for it.

## Simplicity and manual repair

- Keep the schema and logic easy to understand, inspect, and repair manually. Optimize for a
  developer being able to identify what failed and fix the affected records or operation.
- Prefer explicit state, direct operations, and visible failures. Do not hide errors behind
  automatic repair, fallback values, or layers of recovery logic.
- Show the actual API error to the task owner, with its status, error code, and request ID when
  available. Do not replace it with a guessed outage or generic service-unavailable message.
  Log the failed API method and path without logging credentials or request payloads.
- Default to an explicit manual rerun after fixing the cause. Add automatic retries only for a
  concrete current need, with a clear limit and an inspectable failure when that limit is reached.
- Reuse existing mechanisms and keep recovery state minimal. Do not introduce custom retry
  frameworks, repair queues, or reconciliation systems for hypothetical failures.

## Main build labels

- Use squash merges so each pull request becomes one shipped commit on `main`.
- Merge pull requests into `main` one at a time. Do not start concurrent merges.
- Keep branch commit subjects unversioned. They are review checkpoints, not shipped builds.
- Before the first pull request push and before every later pull request push, fetch `origin/main`
  and rebase the pull request onto it. Do not merge `origin/main` into the branch.
- A pull request's projected `v<N>:` label is the commit count on `origin/main` plus one, regardless
  of how many commits the branch contains.
- For a new pull request, run `node ./scripts/pr-build-label.ts --print-only` and use the projected
  `v<N>:` title. After the pull request exists, run `node ./scripts/pr-build-label.ts` after branch
  updates and immediately before merging.
- Immediately before merging, fetch and rebase onto `origin/main`, refresh the title, then squash
  with an explicit subject matching it, for example
  `gh pr merge <pr-number> --squash --subject "v<N>: <title>"`.
- Prefix a direct commit to `main` with `v<N>:`, where `N` is the commit count including that commit.
- CI rejects a `main` commit whose subject does not start with its expected `v<N>:` label.

## Hackathon log

- Run `$convex-hackathon-skill` when finishing a meaningful pull request or product milestone, not
  before every commit. Group related work into one entry and keep it to two to six lines. Do not copy
  PR summaries, test output, rejected approaches, or review notes into the log.
- Keep at most one `working tree` entry. On the next meaningful update, replace it with the previous
  pull request's squash-commit short SHA. Do not create log-only commits except when
  finalizing the submission.
- Format new entry headings as `### YYYY-MM-DD - <short SHA or working tree> - v<N>`.
  Use the projected pull request version for a working-tree entry and the shipped version
  when recording its squash commit.

## Cross-platform automation

- The core workflow must run natively on macOS, Linux, and Windows.
- Put non-trivial repository automation in erasable TypeScript under `scripts/` and run it with the
  Node 24 runtime pinned by `.node-version`.
- Do not add Bash scripts, POSIX-only inline environment assignment, shell parameter expansion, or
  required Unix-only utilities. Set `env` and `cwd` through Node process APIs, pass arguments as
  arrays, and handle Windows `.cmd` entry points explicitly when needed.
- Documentation must use platform-neutral commands or show both POSIX and PowerShell forms when
  their syntax differs.

## Project validation

- Authored application, automation, test, and supported configuration source uses normal `.ts` or
  `.tsx`. Treat an authored `.js`, `.mjs`, or `.cjs` file as a review smell. Keep one only when a
  named tool or runtime cannot use TypeScript, and document that exact boundary. Generated output
  and required shipped browser artifacts can be valid exceptions. Do not add a repository-wide
  extension scanner.
- Run `pnpm run check`. It checks formatting, lint, browser TypeScript, Node TypeScript, Convex
  TypeScript, and tests.
- Run `pnpm run check` before a deploy and `pnpm run build` to verify the build locally.
  GitHub CI runs checks and tests; Cloudflare Workers Builds builds and deploys without rerunning them.

## Code guardrails

- Ordinary data loading stays visually quiet. Keep the page shell, navigation, existing content,
  and pagination labels mounted; use `aria-busy` instead of loading copy or spinners. Reserve media
  dimensions while URLs and images load. Show empty states only after the query completes, and keep
  progress feedback for user actions and background work such as starting a task or preparing a replay.

- Use TanStack Router `Link` and `navigate` for internal navigation. When switching a selected
  task or site, keep its surrounding layout and navigation mounted; put pending states inside
  the content pane and use `resetScroll={false}` for sibling links. Navigation tests must include
  a delayed query response and verify that the sidebar retains its DOM, width, and scroll position.

- Write agent prompts and tool guidance as indented `outdent` multiline templates, with readable
  source lines. Separate topics with blank lines; use short sections and lists for longer prompts.
  Keep inserted data intact; do not dedent or normalize the completed prompt.
- Keep type gaps explicit and searchable. Do not hide them with casts, reflection, handwritten type
  predicates, false overloads, or runtime checks added only to satisfy TypeScript.
- Fix type errors by modeling the value honestly. When a verified dependency or test-double boundary
  cannot be expressed, put the narrowest possible `@ts-expect-error` on the exact failing line and
  explain the concrete runtime fact. Never use `@ts-ignore`, `@ts-nocheck`, an intermediate cast, or
  an `unknown` round trip to launder the mismatch.
- Validate unknown and provider-owned data once where it enters the app. Use one source-of-truth
  schema for that boundary and derive the TypeScript type from the schema.
- After a boundary has parsed a value, trust the resulting type. Do not repeat the same validation
  inside business logic or tool implementations.
- Model variants as discriminated unions with required variant-specific fields. Do not use optional
  field bags that admit unsupported combinations.
- Prefer inference and library-owned types. Do not create parallel interfaces for shapes already
  owned by a schema or dependency.
- Default properties and function arguments to required. Optionality must represent current
  persisted data, external input, migration, or patch semantics.
- When constructing an object with optional fields, use `omitNullish` from
  `apps/scout/shared/omitNullish.ts` instead of repeated conditional spreads. It removes only `null` and
  `undefined`; do not use it when either value is meaningful.
- Prefer delete-first internal refactors. Remove pass-through adapters, mirror types, compatibility
  shims, and one-call helpers unless they protect a current invariant or a real boundary.
- Do not shape production code for test convenience. Test behavior directly and keep the native
  library value or error shape when it already expresses the contract.
- Handle closed variants exhaustively so a new variant causes a compile error at every incomplete
  branch.
- Fail closed on invalid external data. Do not invent placeholder fallbacks or compatibility paths.
- Give persisted and user-visible collections an explicit deterministic order with stable
  tie-breakers.
- `Reflect` is forbidden in authored application, automation, configuration, and test code. Use
  direct typed access or a schema-backed boundary adapter.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`apps/scout/convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
