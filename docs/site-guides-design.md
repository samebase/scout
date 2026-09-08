# Site-guide transfer experiment

This document records the earlier bundled-guide prototype. The current shared-file MVP and its
observed limitations are in the [ChessMerge trial](./shared-site-workspace-trial-2026-09-08.md).
The architecture and proposed scope below describe that earlier experiment.

2026-09-08. The prototype uses Papergames Tic Tac Toe because its baseline struggled to read the
board. Score Four's existing accessibility snapshot already exposed the board well. See
[the actual comparison](./play-trials-2026-09-08.md#papergames-guide-treatment).

One manually curated `papergames-tic-tac-toe` entry uses the existing bundled skill catalog and `load_skills`. One fresh chat discovered and used it. Repeated transfer and completed gameplay remain unproven; shared writable storage is not implemented.

## What already exists

- `convex/scout/skills.ts` owns the name enum, descriptions, guide bodies, ordering, tool schema, and derived Convex validator. `load_skills` replaces the complete active set and returns names only. Its body appears in instructions on the next model step.
- `convex/scout/chats.ts` initializes fresh chats with `activeSkills: []`. Its internal `loadSkills` mutation validates the active turn and saves selection on the chat. `convex/scout/generation.ts` runs one step per slice, reloads that selection, and builds instructions through `runtimeInstructions.ts`. Existing skill and compaction tests cover retention without accumulating guide bodies in messages.
- `convex/schema.ts` binds workspaces to threads. `workspaceStorage.ts` prefixes R2 keys by deployment, user, and thread; `scout/workspaces.ts` checks ownership. The Bash sandbox has no browser or network access. A shared catalog does not require changing these boundaries.
- Model calls already capture exact instructions, messages, tools, and usage. Browser operations and replay provide evaluation evidence. A Scout's browser profile survives chats, so a fresh chat alone does not guarantee a fresh game or account state.

## Scope

| Content                                      | Scope and purpose                                                                                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generic skill, such as `games`               | Reusable task procedure: understand rules, act legally, observe results, continue to the requested outcome.                                                             |
| Site guide, such as `papergames-tic-tac-toe` | A specialized skill for an exact public host and page family. Records how to read that site's visible state and locate its controls. Available across Scouts and chats. |
| Current state                                | Private chat observations, board position, chosen moves, task progress, source files, and summaries. Scout account/profile state keeps its existing separate scope.     |

Share the method for reading the current board. Each chat must obtain its own current board. Exclude credentials, account identifiers, session URLs/tokens, private transcripts, cached answers, and the discovery run's move sequence. Guide instructions remain subordinate to the user's task and existing runtime rules. Public page text does not become trusted instructions merely because it was copied into a guide.

## Smallest integration

The runtime delta is one name in `skillName` and one `{ description, guidance }` entry in `bundledSkills`, plus focused existing-test updates. The schema's imported validator widens automatically; no new table, field, component, query, filesystem mount, or discovery service is needed. The current whole-set semantics allow `load_skills({ names: ["games", "papergames-tic-tac-toe"] })`. The user's test prompt did not mention that call.

The description identifies the host, game, and reading/control purpose. Freeze the body during comparisons and retain its exact text with the run evidence. Selection remains per chat, while the bundled definition is shared by the deployment.

The [Agent Skills specification](https://agentskills.io/specification) defines a portable directory with `SKILL.md`, required YAML `name` and `description`, and a Markdown body. Scripts and references are optional. Scout's current object catalog follows the loading pattern but is not a filesystem-format implementation. Keep the first guide inline; add packaging only when importing/exporting skills is a real requirement.

The [official integration guide](https://agentskills.io/integrate-skills) explicitly supports bundled assets and dedicated activation tools for hosted agents. It separates catalog metadata, activated instructions, and optional resources. The existing loader already supplies the first two levels.

[Convex context control](https://docs.convex.dev/agents/context) supports custom context and cross-thread message search. Scout already supplies prepared messages through `contextHandler`. Cross-thread search retrieves conversation history, which has a different scope from curated public procedures. Keep the existing context assembly and tool registration.

## Extraction handoff

Request one short guide from the extraction lane, ideally under 1,500 tokens, containing:

1. Exact origin/path applicability, visible page fingerprint, verification date, and the limitation when that fingerprint no longer matches.
2. A tested, self-contained JavaScript body for `browser_execute`, using its provided Playwright `page`. Identify the relevant frame if needed. Read rendered DOM/accessibility evidence; do not depend on hidden application stores, framework internals, remembered element handles, or persistent JavaScript globals.
3. Compact deterministic output with coordinate order/orientation, piece and empty-cell meanings, current turn, legal controls, and terminal status. Use the site's actual dimensions and labels. Mark unsupported/unknown readings explicitly; an unrecognized piece must not silently become an empty cell.
4. Stable control locators, how the coordinates map to them, and observable confirmation after a legal action. Keep reading separate from acting and strategy. Include bounded waits and an explicit mismatch failure so the agent re-inspects instead of replaying stale coordinates.
5. Evidence that the snippet works on an initial and changed position, with a small illustrative input/output example. Record terminal-state support only if verified. The evaluator keeps a further position out of these examples.

`browserState()` returns URL/title/tabs, not a board. Browser calls have a 60-second limit and their output is bounded. Return the small reading directly. Only pure computation belongs in an optional private `js-exec` file; it cannot import Playwright or reach the browser. No script loader is necessary for one inline snippet.

## Comparison without coaching

Freeze the parent's exact task prompt, model/settings, chat purpose, site version, starting game settings, and time/step budget. Preserve the baseline before introducing the guide. Use ordinary fresh chats with empty active selections, summaries, and workspaces. Match browser/account starting conditions through normal controls; record any mismatch. Never paste the guide, selectors, solution, or “use skills” hints into either prompt. Do not intervene during a run; record interventions as failures of unaided completion.

Run the treatment once on a fresh chat, then repeat on another Scout with equivalent starting conditions. Each starts from live evidence. Inspect Model calls for spontaneous activation and the exact guide in the next instructions. If the guide is not selected, record a discovery failure. A forced-load diagnostic can follow separately, but cannot count as uncoached transfer.

Compare state-reading correctness first, including at least one changed position absent from the guide. Use replay and independently checked rendered-state evidence as the answer key. Then compare browser calls to the first correct reading, repeated DOM exploration, invalid/stale actions, total steps, elapsed time, input/output tokens and cost, and observed task outcome. Count catalog and loading overhead. A win alone is insufficient evidence of reading transfer.

Proceed only if both fresh treatment chats apply the method correctly and reduce rediscovery while maintaining correctness. This is a small feasibility result, not a reliability estimate. If successful, repeat with a second site using the same bundling approach. Consider a small Convex guide catalog only when editing guides independently of releases becomes necessary. Shared writable files remain a separate need to demonstrate.
