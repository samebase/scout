# Product review trials

Development trials on `acoustic-cat-488`, starting from `dc8b381` on September 15, 2026.
Each uses the normal Review creation endpoint, the existing Luna agent, and a public
review. No screenshot-specific instructions were added to the requests.

| Product | Review task                        | Requested workflow                                                            |
| ------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| Pika    | `s573ya5mcpbp3fhsbb1td0vpr58eeekq` | Capture example.com, customize the frame/background, export the result.       |
| Codédex | `s570fr8gg77f5kwxv53h6gjs9x8ee42j` | Complete a beginner lesson, submit an exercise, verify feedback and progress. |
| Rezi    | `s576j9237g0cry0g49s4r9xc5h8ef39a` | Create a fictional resume, edit an entry, try exporting it.                   |

Requests restrict the trial to free features and ask Scout to report payment or
human-verification blockers instead of requesting a handoff. The browser-control
connector was unavailable, so these were started through the real Review mutation
using the existing development test identity. Public pages were checked in a
separate local test browser.

## Outcome

| Product | Verified result                                                               | Status at the end of the batch                                                                             |
| ------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Codédex | Free signup, exercise execution/submission, feedback, and persisted progress. | Finished without intervention; four-section walkthrough saved.                                             |
| Pika    | Website capture, frame/background selection, and a browser download event.    | Initial run saved a three-section walkthrough. Evidence-quality follow-up failed in the Agents API stream. |
| Rezi    | Free signup and verification, resume creation, saving and editing experience. | Two infrastructure interruptions; export unverified and no finished walkthrough.                           |

All three tasks are inactive and have no open browser attached. These are development
examples, not production content. No payment or human handoff was used.

## What must be checked

- Did the requested workflow complete? Distinguish a product limitation, a browser
  automation limitation, and an interrupted Scout run.
- Do the saved screenshots show the claimed action/result without exposing login
  secrets? Do the captions match the actual screenshots?
- Can an anonymous visitor read the walkthrough and reach the original chat/replay?
- Which screenshot and short description would help someone choose this product
  from a homepage entry?

## Observations

- Pika's research step skipped because the request contained both the product URL
  and the URL to capture. Scout still identified `pika.style` as the primary site.
- Codédex and Rezi completed the automatic research stage and read their task brief.
- Codédex ran `print('Hi')`, accepted the exercise with “You got it!” and +10 XP,
  and retained 20% chapter progress and the completed exercise after reload.
  It finished without intervention and saved a four-section walkthrough. The public
  screenshots show these results. The raw reload caption mentions XP feedback that
  is only visible in the preceding submission screenshot; the finished walkthrough's
  persistence explanation correctly describes the saved progress and DONE state.
- Pika captured example.com and exposed frame/background controls. Its third
  screenshot is scrolled below most of the customized image, so it is poor evidence
  for the claimed final design. The capture also retains a loading notification.
  Its Save click emitted a download event, but returning the data URL flooded and
  truncated the tool output before the `failure` field. Scout's initial walkthrough
  claimed completion more strongly than that returned evidence supports. After its
  initial run finished, a focused follow-up requested a well-framed capture, compact
  export metadata, and separation of picker behavior from a confirmed product bug.
  That follow-up stopped at 16:58 UTC with the same Agents API stream error seen
  in Rezi. The original walkthrough remains saved; the improved capture was not made.
- Rezi completed email verification and reached its free dashboard. A capture during
  the redirect failed explicitly with `Screenshot target navigated during capture`;
  the next dashboard capture succeeded. Its Agents API stream then failed with
  `An internal error occurred`. One manual continuation was sent at 16:50 UTC.
  The continuation created the fictional resume and saved an experience entry,
  then changed its title to Product Designer Intern (Growth). Both saved states
  have matching screenshots. A second navigation capture failed with the same
  explicit navigation error. The run later failed on HTTP 500 from
  `api.beta.agents.sessions.retrieve` at `runtime.ts:428`; export was not reached.
- Anonymous public walkthroughs render and their Next controls load the saved
  screenshots. Two checks timed out waiting for the walkthrough; explicit reruns
  succeeded. Three subsequent fresh-browser loads of Rezi's public walkthrough
  each became ready in 1.3–1.4 seconds with no page JavaScript errors, so the earlier
  timeout was not reproduced or diagnosed.
- The finished Codédex review defaults to Walkthrough for an anonymous visitor at
  1440px and 390px widths. Expand opens the screenshot; switching to Chat shows its
  video replay. Both checks completed without page JavaScript errors.

## Homepage direction

Show one entry per primary site, with a screenshot of an actual product workflow,
what Scout tried, and a link to its walkthrough. Keep other reviews available
under the same site. OAuth and supporting sites remain part of the primary site's
review. Keep the existing review composer and emerald visual theme.

Codédex is the first verified candidate. Use its exercise submission screenshot
(`ss72m8mhjwnj496758wbq87q8d8efxj8`) when demonstrating the result, rather than the
home page. The proposed entry should say what was tested and open the walkthrough;
it does not need a rating or new task categories.

Before collecting more examples, investigate the API interruption path. Both a
stream exception and a session-read 500 terminate the workflow and trigger browser
cleanup. The recorded errors do not establish whether the remote turn itself had
failed when the stream disconnected. Avoid treating all of these as review failures
or hiding them behind unlimited retries.

Then update the homepage around products and their completed walkthroughs. The
landing page has not been changed in this trial batch.

## Site groups and saved checks — September 15

Started task `s573xjaph56j53s22xfbeng2e18eej4v` through the normal composer at
`localhost:5173` against the development deployment. The request was: “Try
https://excalidraw.com. Draw a rectangle, undo it, and redo it. Check whether each
action works.” No instructions about screenshots, check counts, or walkthrough
tools were added to that request.

Scout completed research, read the brief and site workspace, and exercised the
three actions without a handoff. It saved four screenshots and a walkthrough with
three passing checks. Visual inspection confirmed the drawn rectangle, its removal
after Undo, and its restoration after Redo. The walkthrough and homepage display
the stored `3/3 passed` result; no counts were backfilled into older reviews.

The task did not finish cleanly. After Convex saved the walkthrough, the agent
received an HTTP 424/500 tool-transport error for `save_walkthrough`. It attempted
to inspect the captures before retrying, then the OpenAI Agents API stream returned
`500 An internal error occurred` in `runtime.ts:streamOutput`. The task became
inactive and its browser was closed. The saved evidence remains available, and the
homepage retains an Interrupted label beside the check count. The exact cause of
the provider/transport failure is unresolved; this is not a product failure in
Excalidraw or proof of a cleanly completed Scout run.

The actual homepage retains its composer, groups tasks beside a large site image,
expands three Score Four rows to five, and filters by site. Existing walkthrough
links and screenshot expansion work. At a 390px viewport, the site image is 356px
wide and the page has no horizontal overflow. Formatting, lint, all TypeScript
projects, 964 tests, and the local app build passed.

## Interruption audit — September 16

Before the new batch, development contained 17 approved public managed review
tasks: six finished, seven interrupted, and four stopped. This is a snapshot of
task statuses, not a failure rate: tasks span different code versions, can contain
several turns, and include manually stopped experiments. Rejected, unchecked, and
legacy Convex-agent tasks were excluded.

The seven interrupted tasks include three OpenAI API 404 failures, one 409 saying
an MCP call no longer accepted results, and three internal/500 failures. Rezi
failed both while consuming events and, after a manual continuation, while reading
the remote session. Pika finished its original turn before an evidence-quality
follow-up failed. These errors are at the OpenAI integration boundary; their
messages alone do not establish a shared provider-side root cause.

The current branch records these failures and keeps their status visible beside
saved checks. It does not implement an interruption recovery fix.

### Fresh batch

Started through the actual `localhost:5173` composer at commit `bdb0d62`, using
Conrad, Magda, and John respectively. No runtime or prompt changes were made during
the batch; no follow-ups or retries were sent. These are account-free tasks with
the normal request-check, research, and agent path.

- `s57ce9rnhvm6y339eyffjwag6d8ehbn9`: repeat the exact rectangle/undo/redo prompt.
- `s573eqxbmawv1y3m9wk2dwa7458ehyr7`: create a rectangle labeled “Launch”, change
  its fill, export a PNG, and verify its label and color.
- `s572gy87xrctsjawk9bgwmyvvd8ehnxe`: capture example.com in Pika, change its
  background, export with a free option, and compare the export to the preview.

The repeated drawing task finished without intervention, saved four screenshots
and three passing checks, closed its browser, and sent a final answer. However,
visual inspection of its saved screenshots contradicts its “empty canvas” caption:
the starting canvas contains an existing rectangle. Drawing and Redo show two
overlapping rectangles; Undo returns to the original one. The action checks have
support, but the starting-state explanation is inaccurate. Finishing successfully
does not by itself establish review quality.

Pika failed before any browser or agent messages were created:
`api.beta.agents.sessions.create` returned HTTP 503, “The service is temporarily
unavailable” (`runtime.ts:127`). The initial request check had succeeded. There is
no provider session ID, saved screenshot, or walkthrough. This is a fresh OpenAI
API failure, not evidence that Pika or Firecrawl failed.

The colored-rectangle export task reached a human handoff after about 13 minutes.
Its seven saved captures include a blue rectangle labeled “Launch” in the export
preview and the subsequent error: `Failed to execute 'showSaveFilePicker' on
'Window': File picker already active.` The saved PNG itself was not verified.
Scout distinguished the native-picker limitation from a confirmed product failure,
but did not save a finished walkthrough before handing off. I stopped the task at
that boundary to release its browser and Scout; its final Stopped status is a
deliberate test cleanup, not an OpenAI interruption.

This task also encountered HTTP 424 tool-transport errors early in the turn:
`The managed agent session has no active turn`. These appear in the provider's
function-call outputs. Scout retried and later continued through the drawing and
export steps, so a task's final status alone also misses recoverable tool errors.

Batch result: one autonomous completion with an inaccurate starting-state caption,
one native-file-picker handoff with partial evidence, and one OpenAI session-create
503 with no investigation. None needed an account or payment. This small batch
demonstrates current interruptions and concrete report-quality gaps; it does not
estimate their general frequency or show that a proposed recovery change works.

The next experiment should isolate one of these observed problems and compare the
same request before and after the change. Useful candidates are the session-create
503 handling, verifying screenshot captions against the actual captured state, and
supporting file export in the remote browser. Keep those outcomes separate from
product check results; do not treat saved checks as evidence of a finished run.
