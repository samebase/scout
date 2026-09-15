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
