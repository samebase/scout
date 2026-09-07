# Score Four browser extraction guide

Verified on 2026-09-08, Europe/Chisinau. Primary site: <https://score-four.pfp.workers.dev/>.

No essential board-state fact was missing from the tested accessibility snapshot: it exposed coordinates, ordered stacks, the side to move, and available/full peg state. This guide is an extraction reference. It does not resolve Scout stopping for operator input, and no runtime guide integration was attempted.

Research used a new Chrome tab and **Play on this device** at `?play=local`. It did not join the parent's room, inspect other tabs, change names/auth settings, or access Scout's backend. All game observations came from accessibility output, rendered DOM attributes, computed styles, and a screenshot. No application internals, storage, network game APIs, or engine moves were inspected. Only this guide was written.

## Verified extraction contract

The accessibility snapshot already describes the complete playable board. There are 16 peg buttons, A1 through D4. Each peg holds four levels, listed bottom to top. A cell can therefore be identified by `{ peg: "A1", level: 1 }`; array index zero means level 1. Do not derive coordinates from projected screen order.

| Information           | Verified source                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Board                 | `[data-testid="board-controls"]`, a group named `Board pegs. Rows A to D, columns 1 to 4. Levels are listed bottom to top.` |
| Peg                   | Visible `button[data-column]`; `data-column="A1"` agrees with its accessible name                                           |
| Pieces                | `data-stack="maple,walnut,empty,empty"`; accessible label says `bottom to top: Maple, Walnut`                               |
| Whose turn            | `[role="status"]` contains an h1 such as `Maple's turn` or `Walnut's turn`                                                  |
| Available drop        | Accessible name includes `drop Walnut at level 3`; `data-next-level="3"`                                                    |
| Full peg              | Label ends `; full`, `data-next-level="full"`, `aria-disabled="true"`                                                       |
| Local player identity | Visible `On this device`. Both sides use the same device; no separate "your color" identity appeared                        |
| Result                | Preserve the status text. Win/draw wording was not reached or verified                                                      |

The DOM attributes above are on the visible, accessible controls and duplicate the human-facing board description. Plain `innerText` only returns peg names such as `A1`; it omits piece stacks and available-drop descriptions. Read accessible names or these verified attributes.

## Read-only Playwright snippet

Paste into Scout `browser_execute` with its existing `page`. This returns the visible peg controls in deterministic coordinate order. It never clicks or reads app state. Unknown markup fails explicitly; unknown status wording remains `unclassified`, not a guessed win or draw. The code is JavaScript, matching the tool's execution contract.

```javascript
return await page.evaluate(() => {
  const visible = (e) => {
    if (!e || e.closest('[hidden],[aria-hidden="true"]')) return false;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    for (let n = e; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility !== "visible" || s.opacity === "0") {
        return false;
      }
    }
    return true;
  };
  const board = document.querySelector('[data-testid="board-controls"]');
  const status = document.querySelector('[role="status"]');
  if (!visible(board) || !visible(status)) throw new Error("Visible board/status unavailable");
  const pegs = Array.from(board.querySelectorAll("button[data-column]"))
    .filter(visible)
    .map((e) => {
      const peg = e.getAttribute("data-column");
      const label = e.getAttribute("aria-label");
      const stack = e.getAttribute("data-stack");
      const nextLevel = e.getAttribute("data-next-level");
      if (
        !/^[A-D][1-4]$/.test(peg ?? "") ||
        !label ||
        !/^(empty|maple|walnut)(,(empty|maple|walnut)){3}$/.test(stack ?? "") ||
        !/^(1|2|3|4|full)$/.test(nextLevel ?? "")
      ) {
        throw new Error("Unrecognized visible peg markup");
      }
      return {
        peg,
        label,
        levelsBottomToTop: stack.split(","),
        nextLevel,
        enabled: !e.matches(':disabled,[aria-disabled="true"]'),
      };
    })
    .sort((a, b) => a.peg.localeCompare(b.peg));
  if (pegs.length !== 16 || new Set(pegs.map((p) => p.peg)).size !== 16) {
    throw new Error("Expected 16 unique visible pegs");
  }
  const statusText = status.innerText.trim();
  const turn = statusText.match(/^(Maple|Walnut)'s turn$/)?.[1];
  return {
    statusText,
    phase: turn ? { kind: "turn", player: turn } : { kind: "unclassified", text: statusText },
    pegs,
    visibleCanvases: Array.from(document.querySelectorAll("canvas")).filter(visible).length,
    visibleIframes: Array.from(document.querySelectorAll("iframe")).filter(visible).length,
  };
});
```

`visible` checks layout, ancestor styles, and hidden attributes. It does not prove absence of occlusion, clipping, or viewport overlap. Let normal Playwright actionability checks establish whether a control can actually be clicked. `nextLevel` deliberately stays a string because `full` is a real observed value. `phase.player` names the side to move, not the user's assigned online seat.

## Legal UI action and verification

Start local testing through the visible `Play on this device` button. Capture state, select a currently enabled peg using its complete current accessible name, click once, and inspect the resulting snapshot. For example, this exact action was tested on an empty board:

```javascript
await page
  .getByRole("button", {
    name: "A1, empty; drop Maple at level 1",
    exact: true,
  })
  .click({ timeout: 5000 });
return await page.getByRole("status").innerText();
```

The returned status was `Walnut's turn`; A1 became `A1, bottom to top: Maple; drop Walnut at level 2`. A previously captured name becomes stale after a move. Re-extract before another action. Do not use `force`, synthetic DOM clicks, or attempt a peg marked disabled. DOM control state is an observation, not an independent rules engine.

The probe made four successive legal drops on A1, observing each state, then used visible `Undo` and repeated the fourth drop. This sequence tested extraction only.

| Observation                              | A1 bottom-to-top stack       | Next level | Enabled | Turn   |
| ---------------------------------------- | ---------------------------- | ---------- | ------- | ------ |
| Initial                                  | empty, empty, empty, empty   | 1          | true    | Maple  |
| After first drop                         | maple, empty, empty, empty   | 2          | true    | Walnut |
| After second drop                        | maple, walnut, empty, empty  | 3          | true    | Maple  |
| After third drop / after Undo            | maple, walnut, maple, empty  | 4          | true    | Walnut |
| After fourth drop / repeated fourth drop | maple, walnut, maple, walnut | full       | false   | Maple  |

The final snippet was executed on the full board, after Undo, and after the repeated legal fourth drop. Each extraction returned 16 unique pegs. The other 15 stacks stayed unchanged. The initial and first-move states were checked with the earlier equivalent DOM extractor and accessibility snapshots. The script was tested through Chrome's read-only Playwright evaluation tool; it was not executed in Scout's Firecrawl session.

## Scout browser tool contract

Read from the current checkout, without editing runtime code:

- `convex/scout/browserToolContract.ts`: `browser_execute` runs JavaScript with `page` and `browserState(selectedPage = page)`. Await operations, keep one coherent step per call, and stay within the 60-second execution limit. Prefer locators grounded in the latest snapshot; inspect DOM when labels are insufficient.
- `convex/scout/playwrightBrowser.ts`: snapshots use `page.locator("body").ariaSnapshot({ mode: "ai" })`. AI mode includes iframe contents; Scout removes reference metadata. The configured viewport is 1280 by 800. Chrome research used its existing viewport, so screenshot coordinates are not transferable.
- `convex/scout/browserTools.ts`: normal execution returns `currentPage` plus execution `output`; snapshots and outputs are capped at 20,000 characters. Snapshot/observation failures have separate error paths, so a post-action failure is not evidence that a click failed. Inspect state before retrying.
- `browserState` strips URL queries/fragments. Local mode and private-room identifiers may therefore be absent from reported URLs. Use visible mode/seat text and retain your own Page handle. Do not identify a private room solely from the sanitized URL or tab position.

No installation, repository-wide checks, build, deploy, or commits were run for this documentation-only research lane. Browser extraction was validated directly as described above.

## Accessibility versus HTML and pixels

- Verified: Chrome's accessibility output and Playwright DOM snapshot both exposed all 16 peg labels and whose turn. The latter also exposed `role="status"` and the board group. Native accessibility represented `Board map` as a checkbox; the DOM snapshot represented it as a button. Its actual markup is a button with `aria-pressed`. Use the Playwright role/name representation for Playwright locators.
- Verified: one canvas and zero iframes existed in the local game DOM. The screenshot showed the 3D wooden board and visible peg buttons. Canvas pixels are not serialized by `outerHTML`.
- Verified: peg placement uses CSS custom properties `--peg-x`, `--peg-y` and z-index. `getComputedStyle` and `getBoundingClientRect` established that sampled controls were visible with pointer events enabled. HTML alone does not resolve inherited CSS, projection/layout, hit targets, clipping, overlays, or animation timing.
- General gap, not observed here: a top-level HTML dump omits iframe document bodies, including cross-origin frames. Scout's AI accessibility snapshot can include iframe contents; DOM extraction needs explicit frame selection when controls live there. This snippet only reads the top document and reports iframe count.
- General gap, not observed here: normal HTML serialization omits shadow-root contents and pseudo-element rendering. Inspect the rendered document before assuming ordinary element attributes encode the board.
- Unverified: online seat identity, opponent/waiting states, reconnect behavior, terminal win/draw labels, and responsive layouts. A non-turn status should stop automated move selection until its visible meaning is established. Do not infer a result from disabled controls alone.

## Secondary ChessMerge observation

Also inspected <https://chessmerge.com/> in a separate new tab, using its visible `Sandbox` button to reach `/practice`. No existing game was opened or changed, and no account settings were changed.

- Verified: the sandbox says `Play both sides from any position.` and `White to move`. Its `Chess board` group has 64 `button[data-square]` elements. Names include `a2, white pawn` and `a3, empty`; piece images also have descriptive alt text. There were zero canvas and iframe elements.
- Verified: clicking `a2, white pawn` selected the piece without moving it. Its name became `a2, white pawn, selected` with `aria-pressed="true"`. The destination became `a3, empty, legal move` with `data-legal-move="true"`. Thus the UI exposes destination legality in accessibility text as well as the visible green ring.
- Verified: native accessibility represented square buttons as checkboxes, while the Playwright snapshot correctly used `button`. For Playwright, use `getByRole("button", { name: currentAccessibleName, exact: true })`.
- Unverified: a completed move, merged-piece labels, promotion/split controls, terminal results, and online seat identity. The sandbox's `role="status"` was empty while turn text appeared elsewhere, so the Score Four status selector cannot be reused unchanged. No strategy or board-engine inspection was performed.
