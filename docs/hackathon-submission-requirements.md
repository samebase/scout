# Scout submission requirements

Researched September 21, 2026. Preparation notes only; nothing has been submitted.

## Deadline and destination

Submit through the [All Gas entry form](https://vibeapps.dev/judging/convex-all-gas-hackathon-openai/submit)
by September 22, 2026, 12:00 PM Pacific. That is September 22 at 22:00 in Europe/Chisinau,
or 19:00 UTC. The conversion uses both regions' September daylight-saving offsets.
The [official event page](https://www.convex.dev/hackathons/all-gas) gives the deadline.

## Event requirements

- Public GitHub repository with `hackathon.md` at its root.
- Public `convex.site` or `chatgpt.site` app that judges can open without an invitation.
- Demo video shorter than three minutes.
- Convex backend and real use of sponsor integrations.
- A build announcement on X or LinkedIn tagging Convex, OpenAI, Firecrawl, and AgentMail.

These come from the [event checklist and judging criteria](https://www.convex.dev/hackathons/all-gas).

[Organizer registration details](https://luma.com/convex-allgas-hackathon) also require a Luma
registration, a new app started on or after August 25, and a team of at most four people.
Participants must be adults and meet the organizer's eligibility rules. The official event page
specifies August 25 at noon Pacific as the earliest qualifying start.

## Form fields and limits

The live event page requires sign-in before revealing the form. The following is grounded in
its [public form source at commit 7f17164](https://github.com/waynesutton/vibeapps/blob/7f17164d1b2be39afa991bfde0a23a8654690f28/src/pages/JudgingGroupSubmitPage.tsx).
Organizers can change field visibility, required flags, and custom questions. Confirm those
event-specific settings after signing in.

| Material           | Preparation                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------- |
| Project name       | Scout                                                                                     |
| Tagline            | At most 140 characters. Proposed copy below.                                              |
| Description        | Markdown supported. No length cap appears on this textarea in the inspected frontend.     |
| App link           | https://doting-crab-687.convex.site                                                       |
| Repository         | https://github.com/samebase/scout, made public before submission.                         |
| Video              | A hosted demo URL.                                                                        |
| Main image         | A clear screenshot of Scout in use.                                                       |
| Extra images       | Prepare up to four. The displayed limit is four, although the upload handler allows five. |
| Submitter and team | Name, contact email, and team details if shown.                                           |
| Tags               | Select the event and stack tags that are available.                                       |
| Extra fields       | May include social links, a pasted build log, or organizer questions.                     |

Dynamic textareas have a 20,000-character cap. Their presence is configurable. A generic form's
optional repository or video fields do not override this event's requirements.

## Scout's current preparation

| Item                         | Evidence and remaining work                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| App                          | Opened the production homepage while signed out and saw the public review list.                                          |
| Repository                   | GitHub reports it is private. Public release remains to be done.                                                         |
| Build log                    | Present at the root, with an August 26 start. Add the final video link and refresh public repository details when ready. |
| Product story                | Working copy exists in [hackathon-submission.md](./hackathon-submission.md).                                             |
| Video                        | No demo URL is recorded in the draft or log. Choose and verify the review before recording.                              |
| Images                       | Capture the final UI after the identity PR is deployed.                                                                  |
| Registration and social post | Completion has not been confirmed in this task.                                                                          |
| Judge access                 | Public reading works. Task creation requires member access; decide the intended judge experience before the demo.        |

The access distinction is visible in `apps/scout/convex/access.ts` and
`apps/scout/src/products/conversation/page.tsx`. This is a preparation item, not a confirmed
eligibility failure. Do not promise that a new visitor can immediately start a task.

## Recommended submission content

Lead with the person choosing a product and the question they need answered. The event values
everyday usefulness, so signup checks and hackathon reviews should demonstrate that larger purpose.
The [judging criteria](https://luma.com/convex-allgas-hackathon) also assess meaningful Convex use,
sponsor integrations, and evidence in the build log.

Proposed tagline, 105 characters:

> Send an AI agent to try a website for you. See what happened in a walkthrough, screenshots, and a replay.

Use the existing product description as the opening. Follow it with:

1. One concrete review and the question it answered, linked to its public walkthrough.
2. The persistent Scout identity: inbox, browser profile, and accounts across visits.
3. How the stack supports that experience. Explain Convex's saved state and live updates,
   OpenAI's agent work, Firecrawl's browser and web tools, and AgentMail's inbox and verification flow.
   Distinguish the selected demo engine from the other execution options.
4. One implementation challenge with its actual solution, such as retaining identity across browser
   sessions or keeping reported outcomes tied to saved evidence.
5. What remains limited, including agent failures and any access restrictions judges will encounter.

These are proposed writing sections, not verified organizer questions. Avoid unverified usage
metrics and claims that every review succeeds.

## Demo outline

Target 2:30 to 2:45 so the final export stays below the limit.

| Time      | What to show                                                                         |
| --------- | ------------------------------------------------------------------------------------ |
| 0:00–0:15 | A product question and the Scout homepage.                                           |
| 0:15–0:40 | Preparing the request and the Scout identity that will use the product.              |
| 0:40–1:35 | An actual review's key browser actions, then its walkthrough and screenshots.        |
| 1:35–2:05 | The replay and public link so viewers can inspect the attempt.                       |
| 2:05–2:30 | The sponsor services' concrete roles, followed by the live app and repository links. |

Use a completed review for the recording and label any edited time jumps. This demo outline
does not require adding anything to the homepage. Choose the review for a clear, reproducible
product question and readable evidence, then verify the public walkthrough and replay before recording.
