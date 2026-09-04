# Scout chats

A Scout is a persistent identity with its own inbox, browser profile, and service accounts.
A chat is a conversation with one Scout. The user's messages define the work; there is no required
Product, Task, Attempt, claim, or experiment.

## Identity and accounts

Scouts outlive chats and browser sessions. Switching between Qwen, Luna, and Manual does not change
the Scout or its accounts. A chat may use several services, such as Samebase, Cloudflare, and GitHub.

Every service account has an explicit login method: a managed password on an exact host, or OAuth
through another account belonging to the same Scout. OAuth consent for the Scout's own accounts is
ordinary agent work. Human handoff is for something the agent cannot complete, such as a CAPTCHA.

Managed passwords live in an encrypted table. The master key is a deployment secret, not database
data. The model sees account metadata, not passwords or encrypted envelopes. `fill_account_password`
checks the current HTTPS host and password input types before filling the configured credential.
`record_authenticated_service_account` re-reads visible account identity and sign-out controls;
its latest observation links to the chat and browser session. See
[managed credentials](./scout-credential-store-decision.md).

## Chat execution

The Convex Agent component stores messages, tool calls, results, and streams. `scoutChats` binds an
Agent thread to its owner and Scout. `scoutTurns` records each model generation's state, usage, and
failure; it is execution metadata, not a user-facing task hierarchy.

A message starts one durable Convex workflow using the selected model and the Scout's resources.
The workflow runs one model step in each action and can continue the same turn for up to
120 steps or 45 minutes. Each completed slice records cumulative step and token usage before the
next action starts. Slices are not retried because browser and email tools have external effects.
They reuse the original prompt and reattach to the same open browser session. A follow-up continues
the same conversation; it does not need a new attempt or a successful verdict from the previous
generation. Browser operations are exclusive, so a model response cannot queue several browser
mutations inside one action.

The current turn objective is restored if it falls outside the Agent component's recent-message
window, and older browser snapshots are compacted. There is not yet a semantic checkpoint of older
chat history. Captured model inputs make that limitation visible before a compaction policy is added.

Manual calls run the same browser, account, mail, and research tools without invoking a model.
Their inputs and outputs appear in the same transcript. Manual browser sessions stay open between
calls until closed or expired; a model generation can attach to that chat's open session. Automatic
generations close their browser on completion, except when waiting for human help. A Scout's
persistent browser profile is shared, so only one chat may hold its open browser at a time.

Mail reads use AgentMail's hosted MCP tools and remain scoped to the Scout's configured inbox.
`send_message` and `reply_to_message` use AgentMail's REST API from the same inbox. The model chooses
the recipient and copy when email materially advances the user's task. Registration verifies the
stored ID and address against AgentMail; runtime tools fix every mail call to that persisted inbox
and supply a deterministic idempotency key for every write. Incoming email is read only when Scout
invokes a mail tool; no webhook or ambient email turn runs in the background.

`web_search` and `web_read` use Firecrawl's SDK for public research. Browser work uses
`create_new_firecrawl_session`, `browser_execute`, and `browser_close`. The execution tool accepts
JavaScript with Playwright, including normal tab operations. Its description includes the exact
`browserState()` helper implementation. Old page observations are compacted in model context;
the stored transcript retains the full tool results.

## Inspection and handoff

Chats show the transcript beside the current Live view or completed Replay. The URL carries the
selected chat, browser session, and inspected model call.
Tool errors and generation errors remain visibly distinct from successful output. Model turns
show token usage and estimated cost; session records show Firecrawl duration and credits when
the provider supplies them. A turn's Model calls section lazily lists its model requests; selecting
one replaces the transcript pane with the standardized SDK instructions, messages, tools, and
settings captured immediately before that provider call. It is not a raw HTTP request. Manual calls
have no model-token cost.

Browser sessions and operations use one shared set of tables for every chat. Provider control
handles remain server-side. Live and replay access checks the chat owner. Replay uses Firecrawl's
recordings rather than recording a second video in Scout; see
[Firecrawl limitations](./firecrawl-limitations.md).

A human-help request pauses the model generation and leaves the remote browser open. Scout describes
the visible human-only check, while the server writes the email, adds the private handoff link, and
sends it from that Scout's AgentMail inbox. The private page shows the requested check. The link
allows up to 45 minutes to open it; the five-minute control window starts on first open. It does not
require signing in. The operator finishes the check and presses Continue. A Convex workflow waits
for the Scout to finish pausing, captures the final page, closes the browser, and queues a new
generation in the same chat. Expiration and failure also close the browser. Normal chat/tool input
is blocked while that handoff owns the session.

This runtime does not rewrite stored transcripts or add a task, attempt, or supervisor hierarchy.
