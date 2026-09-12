# Firecrawl limitations observed during Scout development

These are useful implementation notes and concise answers for hackathon review. They are provider
boundaries, not defects Scout can fully repair in application code.

## 1. Managed-password delivery

Firecrawl's public [Execute API](https://docs.firecrawl.dev/api-reference/endpoint/browser-execute)
accepts executable code. It does not document an opaque credential handle or a separate secret
injection channel. Scout must therefore send the plaintext password to Firecrawl when the trusted
browser tool fills a form. Firecrawl is a trusted credential processor in this design.

Within the trusted-site hackathon threat model, Scout keeps direct plaintext out of its own model
prompts, tool arguments and results, Convex Agent history, public queries, and structured browser
operation records. The chat binds one Scout; the current HTTPS host selects its exact managed
credential. The model supplies only visible password-field targets. Trusted server code verifies
the login host and password input types, decrypts that credential, registers it for
redaction, and fills it. Scout records the field count rather than field values, scrubs
the exact and URI-encoded password from later model-visible output, and replaces provider failures
after secret use with constant messages.

Scout keeps the normal persistent Firecrawl profile, session recording, streamed live view, replay,
operation capture, and human takeover for browser sessions. Those features are important for account
reuse and review, but Firecrawl-rendered live view or replay may capture the browser while a password
field is populated. Scout cannot retroactively scrub provider pixels or prove that provider logs
exclude Execute request bodies.

The public [Browser Sandbox documentation](https://docs.firecrawl.dev/features/browser) documents
`streamWebView`, but it does not promise that Execute request bodies are excluded from provider
logs. A malicious site could also transform or split a password before reflecting it, beyond
Scout's exact-value scrubber.

A stricter future design needs either a Firecrawl-native opaque secret API or a custom CDP broker.
The broker would authenticate in a private disposable browser, close the credential-bearing
document, transfer only allowlisted authentication cookies, and expose a separate clean browser to
the model.

## 2. Replay boundary

The official Firecrawl Node SDK creates, executes, lists, and deletes Browser Sandbox sessions. It
does not expose replay methods. Firecrawl's current API implementation records Browser sessions by
default and registers two replay routes: one returns recorded-page metadata and one returns that
page's HLS playlist. Scout keeps those two GET requests in
`apps/scout/convex/scout/lib/firecrawlReplay.ts`. Every other Firecrawl request goes through the official SDK.

The relevant Firecrawl source is the
[v2 route registration](https://github.com/firecrawl/firecrawl/blob/main/apps/api/src/routes/v2.ts)
and the
[replay controller](https://github.com/firecrawl/firecrawl/blob/main/apps/api/src/controllers/v2/browser-replay.ts).
The routes are absent from Firecrawl's public Browser documentation, Node SDK, and
[published OpenAPI specification](https://github.com/firecrawl/firecrawl-docs/blob/main/v1/api-reference/v2-openapi.json).
They are real server endpoints, but they remain an undocumented provider boundary. If Firecrawl adds
replay to its SDK, that implementation should replace the isolated client.

Scout does not record or encode the video. It reconstructs a shared timeline from recorded-page
timestamps and Scout's browser-operation telemetry, then plays Firecrawl's HLS playlists. `hls.js`
provides playback in browsers without native HLS support; browsers with native HLS use their built-in
player. Firecrawl exposes no replay resolution, bitrate, frame-rate, codec, or quality setting that
Scout can request.

## Short reviewer answer

Scout owns credential storage and the model boundary, but Firecrawl remains trusted for the moment
of browser entry. Scout also displays Firecrawl's HLS replay as supplied, with no documented quality
control. Its model-output redaction and structured telemetry do not make provider-side browser
pixels or request bodies secret.
