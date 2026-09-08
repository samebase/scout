# Shared site workspace trial

September 8, 2026. Primary checkout, localhost:5173, `acoustic-cat-488` development deployment.
The MVP adds an optional hostname to the existing Bash tool. It uses the same saved filesystem,
shell runner, and file limits as chat workspaces. These initial trials preceded the Sites UI.
ChessMerge has no bundled site guide. No files were seeded for the agent.

## First learning run

[Magda's chat](http://localhost:5173/chats?thread=m578ykthdcpep5vx5nhwwdtae18e1cty), Qwen 3.7 Flash.

Prompt: "Explore ChessMerge's practice mode at https://chessmerge.com/. Make a couple of legal
moves to check how the board controls work, then save what you learn so another Scout can use it
next time."

Magda struggled with the entry controls, used `document` outside page evaluation, tried an async
predicate in `Array.find`, and guessed `/sandbox` before finding `/practice` from the rules page.
It then observed legal-destination labels and played e2–e3 and e7–e6. It also checked Undo and the
setup-link control, wrote a 93-line guide, and closed the browser.

Both Bash calls omitted `workspace`. The guide was saved privately as
`/workspace/chessmerge-sandbox-notes.md`; the shared `chessmerge.com` workspace did not exist.
The requested reuse across Scouts failed despite the notes being written. Model-call inspection
confirmed that the hostname argument and shared-workspace tool description were present in the
actual request.

The guide also claimed that undoing Black's move returned to White's turn, an incorrect inference.
Successful file persistence alone does not establish guide quality.

Recorded usage: 19 completed steps, 242,957 input / 4,727 output tokens, approximately $0.007556
model cost, 230.5 seconds, 8 Firecrawl credits, 211.5 browser seconds. These are observations,
not a controlled latency benchmark.

## Instruction adjustment

The main runtime instructions still described Bash only as a private chat workspace. They now
describe both scopes and instruct Scout to check and save reusable site methods using the hostname.
That procedure was removed from the tool description, which retains the mechanics and scope.
The tool schema and storage implementation were unchanged between learning trials. The same
prompt, Scout, and model were used in a fresh chat; browser profile state can persist.

## Repeat learning run

[Fresh Magda chat](http://localhost:5173/chats?thread=m57awfkv7kmd10xar999qw4scx8e0hk9).
Magda entered practice through the correct button and made moves after inspecting legal targets.
It also tried an unsupported two-square pawn move, then explored the Advanced panel. The saved
guide included useful square locators but invented `/sandbox` as the route and contradicted the
observed turn changes. No notes were supplied by the operator.

The save again omitted `workspace`, producing a private file at
`/workspace/chessmerge-sandbox-guide.md`. Moving the guidance into the main instructions did not
produce an unassisted shared save in this trial. Recorded usage: 12 steps, 165,437 input / 3,525
output tokens, approximately $0.005421 model cost, 175.4 seconds, 6 Firecrawl credits, 154.9
browser seconds.

## Assisted save diagnostic

The operator then sent: "Save the guide in the shared chessmerge.com workspace so other Scouts
can access it." This is assistance, not part of the uncoached learning trial.

Scout first tried copying through `/tmp` across separate calls, then tried a directory named
`chessmerge.com` inside the private workspace. It eventually supplied the real `workspace`
argument but attempted to copy a private source path from inside the empty site workspace.
These workspaces are separate filesystems; the MVP has no cross-workspace copy operation.

It recovered by rewriting the guide with a heredoc in the shared workspace, then confirmed the
file with `ls` and `wc`. The saved file is 3,475 bytes and 71 lines. This proves a real Scout can
write to the shared R2-backed workspace; it does not prove automatic learning or correct content.
The incorrect route and turn claims were retained. Recorded usage: 6 steps, 83,538 input / 1,567
output tokens, approximately $0.00271 model cost, 47.6 seconds, no browser operations.

## Fresh Scout reuse trial

[Conrad's chat](http://localhost:5173/chats?thread=m57e02ywbenrhgmanrz4eefmb18e0y2q), Qwen 3.7 Flash.
The shared file existed before this chat started. Prompt: "Open ChessMerge's practice mode at
https://chessmerge.com/ and make three legal moves. Tell me what you played."

Conrad made no Bash calls and did not discover the guide. The first Model calls snapshot confirms
that the main instructions included checking shared guides by hostname. It repeated the browser
`document` error and a promise-handling mistake while finding the Sandbox button, then recovered
to accessible controls. It played e2–e3, b7–b6, and g1–f3, confirmed the final position, and closed
the browser. The gameplay request succeeded; unassisted guide reuse failed.

Recorded usage: 9 steps, 115,663 input / 1,993 output tokens, approximately $0.003729 model cost,
112.1 seconds, 4 Firecrawl credits, 101.3 browser seconds. The inspector also contains two failed
model-call records saying the call was retried before a response completed; these records alone
do not identify a provider failure.

## Assisted cross-Scout read

The operator then sent: "There is a saved guide in the shared chessmerge.com workspace. Read it
and check whether it matches what you just observed."

Conrad immediately ran `ls` and `cat` with `workspace: "chessmerge.com"`, successfully reading
Magda's saved file. It correctly identified the `/sandbox` versus `/practice` discrepancy. It also
accepted the guide's false turn-switching claim and invented a stale-turn-label explanation.
The original second-move tool output explicitly says "White to move", contradicting its claim
that the label always said "Black to move". Older snapshots were compacted in the later context;
we have not established why it made this inference.

Recorded usage: 2 steps, 33,280 input / 994 output tokens, approximately $0.001128 model cost,
22.2 seconds, no browser operations. This verifies real cross-Scout file access after an explicit
request. It does not establish that the guide improved gameplay or that Scout can reliably audit
its own saved instructions.

## Results

The storage and scope selection work through the existing Bash tool. Automated tests also cover
different users, permission checks, private isolation, saved-script execution, and stale writes.
The live runs used different Scouts under one signed-in user.

The observed gaps are discovery, transferring a file between independent workspaces, and guide
accuracy. Explicit shared access works; automatic learning and improved game performance remain
unproven.

## Site page verification

The subsequent UI exposes existing workspaces at `/sites` and `/sites/<hostname>` with the same
file browser, preview, download, and terminal. On the primary dev deployment, the ChessMerge page
loaded Magda's existing guide, saved `ui-check.txt` through the terminal, and reopened the file from
its bookmarked URL after reload. The Download link selected that file.

Conrad was then asked, "What does ui-check.txt in the shared chessmerge.com workspace say?"
It read the file through Bash and returned the exact line written in the site terminal. The
temporary file was removed afterward. This verifies that the standalone UI and agent access the
same persisted files. It is a storage integration check, not another autonomous-discovery trial.

## HTML read verification

[Conrad's chat](http://localhost:5173/chats?thread=m57a7kz67z0rry9h4vcm9zw6f18dzv6c), Qwen 3.7 Flash.
Prompt: "Save raw HTML and Markdown copies of https://example.com/. From the saved HTML, tell me
the page title and where its link goes."

Scout selected both formats, saved separate source files, and correctly identified the title and
link. A follow-up asking for the heading and links as JSON produced a saved JSON file through
`js-exec`. This verifies format selection and simple source-text processing, not general HTML parsing.
