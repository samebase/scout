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

## Startup

- Install Vite+ once to supply Node.js, then run `corepack enable` to make pnpm available.
- Use `pnpm run dev` for normal development. It selects the primary or linked-worktree flow.
- Vite+ stays in `package.json` and supplies the dev, format, lint, test, and build tools behind the
  package scripts.

## Main build labels

- Use merge commits for pull requests into `main`. Do not squash.
- Merge pull requests into `main` one at a time. Do not start concurrent merges.
- Keep ordinary branch commit subjects unversioned while work is in progress.
- Immediately before merge, fetch `origin/main` and rebase the pull request onto it. Do not merge
  `origin/main` into the branch. Capture the old-to-new commit mapping so rewritten Hackathon
  references can be repaired.
- After rebasing, rewrite every pull request commit subject with `v<N>:`, where `N` is that commit's
  total reachable commit count. Preserve the original subject after the prefix. The mechanical
  Hackathon finalizer is part of the pull request and receives a version too.
- Treat the rebase and subject rewrite as incomplete until `hackathon.md` has been updated and every
  committed SHA in its log headings resolves uniquely to a commit reachable from `HEAD`.
- Push rewritten pull request history with `git push --force-with-lease`, then run
  `node ./scripts/pr-build-label.ts` so the pull request title receives the next version reserved for
  the merge commit.
- Repeat the rebase, commit numbering, Hackathon repair, force-push, and title refresh immediately
  before merge if another pull request changed `main`.
- Merge with an explicit subject matching the current versioned pull request title, for example
  `gh pr merge <pr-number> --merge --subject "v<N>: <title>"`.
- Prefix a direct commit to `main` with `v<N>:`, where `N` is the commit count including that commit.
- CI rejects a `main` commit whose subject does not start with its expected `v<N>:` label.

## Hackathon log

- Before each commit, run `$convex-hackathon-skill`. If it updates `hackathon.md`, include that file
  in the commit.
- After all substantive pull request changes and review fixes are committed, run the skill again on
  the clean branch. If it replaces the final `working tree` entry with a commit SHA, commit only
  `hackathon.md` with the subject `docs: finalize hackathon log`.
- Treat that finalizer as a mechanical commit and do not add a log entry for the finalizer itself.
- After any rebase or commit-subject rewrite, run the skill again and replace every affected logged
  SHA with the corresponding reachable commit. Preserve the existing log heading format and amend
  the finalizer with only these log repairs.
- Verify every committed SHA in `hackathon.md` with an ancestry check against `HEAD`; object existence
  alone is insufficient because obsolete pre-rebase commits can remain in Git's object database.
- Do not merge while the latest hackathon entry says `working tree`. If substantive changes follow
  the finalizer, repeat the finalization step before merge.

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
  TypeScript, tests, and generated Cloudflare redirects.
- Run `pnpm run build` before a deploy. The real Cloudflare build path runs the complete check before
  it builds the app.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
