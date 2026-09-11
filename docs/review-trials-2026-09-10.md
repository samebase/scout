# Review baseline — 2026-09-10

Primary checkout `cc66910` unless noted, dev deployment `acoustic-cat-488`, private Review chats.
All Scouts used `openai/gpt-5.6-luna` with `reasoningEffort: max`, verified in
persisted turns. Prompts and tools were unchanged unless noted. The initial sites
came from [Outbid](https://outbid.lol/); the user suggested Samebase.
These are individual observations, not a reliability score or a comparison with Qwen.

## Samebase tab-selection investigation

Conrad used Luna Max on the primary development deployment. These are individual
trials, not a reliability score. The browser fix below was not deployed to production.

### Baseline

> Try Samebase by creating a disposable app. Check that the deployed app actually works

[Review](http://localhost:5173/review?thread=m572bv2cqq19dffg3cvh6b16x18e5qst),
browser session `qh71q6k6jvyzk82w3qx1jmay7h8e5yqg`. Existing provider accounts.
No follow-up coaching. Scout created and deployed an app, added a todo as a guest,
and confirmed it survived reload. The run completed in 600.5 seconds, using about
$0.08173 in model calls and 19 Firecrawl credits.

Tool output from the deployed app repeatedly arrived beside the Samebase dashboard's
snapshot. In `#IZh7onKp`, the dashboard remained active after code brought the app
tab forward. Two direct Firecrawl probes reproduced this: both tabs reported
`document.hasFocus() === true`, so the observer selected by page order.
`browserState(target)` reported the target without updating that observer.

Scout also mistook the Todo list heading for navigation, invented `/todos`, and
reported its 404 as a bug. Its own control list showed only Home and About links.
The wrong-page snapshot does not establish why it made that unsupported assumption.

### Fix and verification

`browserState(target)` now selects the Page for snapshots and subsequent execution
using its browser target ID. Convex retains that selection across reconnects.

- Direct Firecrawl checks passed switching in both directions, reload, reconnect,
  selection followed by a script error, and selection between identical-URL tabs.
  Closing the old tab after selecting the remaining one also worked.
- The project check passed with 669 tests and 3 skips. Regression coverage includes
  ambiguous focus, reordered and identical-URL tabs, error snapshots, and persistence.
- A fresh [Review](http://localhost:5173/review?thread=m575hfns5yv5enr0fcdh2zbp5d8e4j4n)
  opened the app and example.com, returned to the app with `browserState(page)`,
  added a todo, and verified persistence after reload. Subsequent calls stayed on
  the app. It completed without coaching in 108.9 seconds, using about $0.007388
  in model calls and 3 Firecrawl credits.

### Fresh Samebase signup, September 11

The user authorized deleting Conrad's Samebase account. The operator removed its
repository registration, sole-member organization, and account. External GitHub,
Cloudflare, and Convex accounts and resources were retained. Scout's historical
account registry was also retained.

> Create your own account at https://samebase.com/ and try it by creating a disposable
> app. Check that the deployed app actually works.

[Review](http://localhost:5173/review?thread=m572w6h1q6pm0r0d69sj7rd29x8e4drd),
browser session `qh7ekzme8khcmjpej22k3t72zs8e5htd`.

- Completed GitHub sign-in, new-account terms, organization creation, GitHub app
  authorization, Convex team OAuth, and Cloudflare OAuth. The selected GitHub popup
  and subsequent return to Samebase had matching snapshots and persisted target IDs.
- Created [a disposable app](https://samebase-disposable-test.conrad-db9.workers.dev/),
  but Convex killed `scout/generation:runSlice` before verification with its
  likely 512 MB memory-limit error. The cause remains unproven. The failed turn
  used about $0.07295 in model calls and 19 Firecrawl credits.
- After the operator sent "Continue checking the app you created," Scout added a
  todo, marked it complete, visited About, and confirmed persistence after reload.
  An independent local browser saw the same completed item. This recovery used
  about $0.04331 in model calls and 6 Firecrawl credits. Both sessions closed.

Unresolved observations: Automatic replay showed the GitHub popup at 2:10 and
Samebase at 3:03, but could not choose between two identical-URL app recordings at
7:40. Scout also spent unnecessary calls on Cloudflare's password form despite its
SSO requirement, and did not refresh its saved account observations. This tab fix
does not resolve replay matching, account memory, or the memory-limit failure.

## Earlier trials

### Understand a product

> What is https://see.io/?

[Conrad's chat](http://localhost:5173/chats?thread=m57b4bfgfjx6d6fygg5xq6jwzd8e4zh5),
turn `p974kvyk9g8kvd4watt9m2xc2s8e563v`.

- Answered from the homepage, terms, privacy notice, and browser FAQ. Explicitly said
  it had not submitted a build or verified generated-site quality.
- Took 162 seconds, 13 generation requests, and 18 tool calls. Recorded model cost:
  $0.02362, excluding browser and web-tool costs.
- `web_read` saved `/workspace/sources/see.io/index-a9a1d577.md` in the private chat
  workspace. Scout supplied `workspace: "see.io"` to Bash, got file-not-found, then
  searched the wrong workspace again and repeated homepage/terms/privacy reads.
  It eventually retrieved missing FAQ content through the browser.
- The answer was unnecessarily long for the question, including reproduction steps
  for reading the pricing and FAQ. Review's current guidance requires reproduction
  steps for findings; this is a candidate cause, not a tested explanation.

### Try the product

Natural follow-up in the same chat:

> Can you try it and see if it actually works? A simple page for a fictional coffee
> shop is enough. Stay on the free option.

Turn `p97e5a6rc7746shrqzwkpj9a6n8e4ft3`.

- Submitted a fictional coffee-shop idea and reached signup. Prepared an encrypted
  password and used the password-fill tool after correcting one malformed call.
- Signup rejected Conrad's configured inbox with: "That email address can't receive
  mail. Please use a different one." The cause is unknown; a domain filter and a
  deliverability check are possibilities. This does not establish an AgentMail outage.
- Scout then tried sign-in despite lacking a successful signup, retried signup with
  the literal password `placeholder`, and submitted an invented address at the same
  domain. The last observed signup still showed the email rejection.
- The operator stopped the run after noticing the invented address. This was an
  interrupted trial, not an autonomous completion. No successful signup or build was
  observed. Stop completed and closed the browser. Recorded time: 207 seconds;
  model cost: $0.04415, excluding browser and web-tool costs.
- The saved model input immediately before the invented-address call still contained
  the correct Scout identity and the prohibition on generic password entry. This was
  an instruction-following failure, not a missing deployment of those instructions.

### Verify a feature

> Can https://utilitykit.tools/ format and validate JSON reliably? Try it and tell me
> what works or breaks.

[Magda's chat](http://localhost:5173/chats?thread=m5744rfn36mfdhzfm3egea4ya58e5gc3),
turn `p974q3feaap8bf5s2sm7ra6cjd8e4w8p`.

Completed autonomously without operator hints: 589 seconds, 28 generation requests,
two compaction requests, and $0.14759 recorded model cost, excluding browser costs.

- Selected the research skill, checked the site's shared workspace, opened the actual
  JSON formatter, and exercised nested values, root primitives, Unicode, invalid
  syntax, minification, clearing, clipboard access, large inputs, and numeric limits.
- Reused a nonexistent `main` selector after it had already timed out, then recovered
  using observed controls. Clipboard reading also exhausted a browser call before it
  checked permissions. Later it tried filling a read-only output, then reopened the
  browser to test the keyboard shortcut in an empty session.
- Independently reproduced through the site's UI: valid nested/Unicode JSON formats;
  invalid JSON shows an error while retaining the old output; integer
  `9007199254740993` becomes `9007199254740992`; Ctrl+Enter leaves output empty while
  clicking Format on the same input works. These checks were not fed back to Scout.
- Scout's final answer correctly distinguished ordinary formatting from lossless
  formatting, documented numeric changes, and qualified its network observation as
  a limited test rather than a privacy audit. It reported concrete actions/results.
- One cross-browser difference remains: Scout observed invalid input clearing output,
  whereas the independent local browser retained it. Its original `rnFex7Ql` tool
  result confirms empty outputs for its invalid cases, so this is not evidence of a
  fabricated claim. Page headings/layout also differed; the cause was not established.
- The final answer was long and repetitive, but the main independently reproduced
  findings were useful. Compaction did not prevent completion. No shared site guide
  was written during this trial despite two site-workspace inspections.

### Retry see.io with John on a custom domain

The user created `john@eggfit.com` and registered John Eggfit in Scout. Fresh private
Review chat, unchanged prompts/tools, and an empty shared see.io workspace. Unlike
Conrad's attempt, this run had no preceding research turn, so it is not a controlled
comparison of inbox domains alone.

> Try https://see.io/ and see if it actually works. Build a simple page for a fictional
> coffee shop. Stay on the free option.

[John's chat](http://localhost:5173/chats?thread=m57dg1h6jtkc087m0y1awzwh0x8e50rr),
turn `p974kf3t84qey3yax84sdvja618e5paf`.

- Signup accepted John's address, opened an authenticated dashboard, and started a
  build. Scout used the encrypted password tools and immediately recorded the account.
  Persisted service account `m176qp5bgzwbs54pez5508rrbd8e56kx` belongs to John and has
  `authenticationEvidence.kind: "succeeded"` with a managed password.
- Completed autonomously in 234 seconds: 17 generation requests, no compactions,
  $0.02252 recorded model cost, and 7 recorded browser credits.
- Published [Ember & Bean](https://merry-prairie-19.s5.seeiousercontent.com/). Independently
  opened it outside Scout's browser and followed the menu link. The expected cafe
  sections, drink prices, hours, and fictional contact details were present.
- The dashboard states free hosting expires after about 24 hours. No paid hosting
  was enabled. A snapshot simultaneously showed "Session complete" and "BUILDING",
  supporting Scout's report of a stale dashboard status.
- One wait call was rejected because account recording and a browser operation ran
  concurrently. Scout retried the wait successfully.
- After the builder reported completion, Scout opened the generated site in a new
  tab. Tool call `Dyw4xGL0` returned its URL, title, and full accessibility snapshot,
  including the cafe sections. It then explicitly called `browser_close` in
  `TnrmAbCb`. The page was visible to the model; this was not a forced closure or a
  missing snapshot. Scout performed no further interactions on the generated site.
- The final answer called the layout responsive, but Scout did not perform a mobile
  viewport check. That property was claimed by the builder, not independently tested
  by Scout. No shared guide was saved. Repeat-login and mail delivery were not tested.
- The user found the review insufficient: it should exercise the result instead of
  concluding after generation. Signup, generation, and readable page content were
  verified, but navigation, layout, and the edit/update flow were not tested by Scout.
  The independent menu-link check above was the operator's work and must not count
  toward Scout's autonomous coverage.
- John's success establishes that this custom-domain inbox gets past the observed
  signup rejection; it does not establish see.io's filtering policy for `agentmail.to`.

### Missing footage after opening the generated site

- John's browser session is `qh7eshrafftet7gd1y4a1802t18e4af4`, Firecrawl session
  `01a08c76-d679-740e-804a-03340b3053d4`. The final operation observed the generated
  page as active about nine seconds before session closure. The two observed tabs
  were the dashboard and generated page, not an extra blank startup page.
- Firecrawl's replay endpoint itself returned only page `0`, labeled `https://see.io/`,
  with 190.017 seconds of footage. Its playlist contained nineteen approximately
  ten-second segments. Scout's replay player did not discard a generated-page track.
- A separate SDK-only comparison used the same Firecrawl browser options without a
  saved Scout profile. It navigated the original tab, opened the generated page with
  `context.newPage()`, waited 15 seconds, explicitly brought that tab forward and
  waited another 15 seconds, then navigated the original tab to the generated page.
  Firecrawl returned both recordings. Session: `01a08c8c-3f6d-778d-a44c-b0eb37c1e58b`.
- A second comparison kept the generated tab open for eight seconds without an
  explicit `bringToFront()` and also returned both recordings. Session:
  `01a08c8e-d671-7590-bf88-62a1eb0f7825`. Both tests used the public generated site,
  performed no account operations, and closed their browser sessions.
- These comparisons show that `newPage()` is supported and can be recorded even
  during a short visit. They do not reproduce the missing track or establish a safe
  minimum delay. The reason John's generated-page recording was omitted is unresolved.
- The tool's `browserState` helper now omits background `about:blank` entries, but
  retains the selected page even when blank. Full browser telemetry remains intact.
  Direct helper checks and the full project check passed, with 666 tests passing.

## Next comparisons

- Fix one observed issue at a time, then repeat the same prompt and a prompt on a
  different site. Keep model/effort unchanged and record whether the site workspace
  was empty or already contained learned material.
- First candidates: make returned file locations identify their workspace; ensure a
  signup blocker does not lead to invented account identities or unmanaged passwords.
- Judge completion by the requested outcome and supporting tool results. Reading
  marketing pages is sufficient for an explanation, but does not verify a feature.
  A precisely reported access blocker is a useful review result.
- Keep screenshots, tool results, model calls, and costs in the existing inspector.
  No manager agent or evaluation framework is needed for the next comparison.
