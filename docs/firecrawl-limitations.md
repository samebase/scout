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
operation records. An account-creation run binds one exact managed service-account ID before it
starts. The model supplies only visible password-field refs. Trusted server code verifies the exact
HTTPS login host and password input types, decrypts the bound credential, registers it for
redaction, and fills it. Scout records refs and character counts rather than field values, scrubs
the exact and URI-encoded password from later model-visible output, and replaces provider failures
after secret use with constant messages.

Scout keeps the normal persistent Firecrawl profile, session recording, streamed live view, replay,
operation capture, and human takeover for managed runs. Those features are important for account
reuse and review, but Firecrawl-rendered live view or replay may capture the browser while a password
field is populated. Scout cannot retroactively scrub provider pixels or prove that provider logs
exclude Execute request bodies.

The public [Create Session API](https://docs.firecrawl.dev/api-reference/endpoint/browser-create)
documents `streamWebView`, but it does not document `recordSession` or promise that Execute request
bodies are excluded from provider logs. A malicious site could also transform or split a password
before reflecting it, beyond Scout's exact-value scrubber.

A stricter future design needs either a Firecrawl-native opaque secret API or a custom CDP broker.
The broker would authenticate in a private disposable browser, close the credential-bearing
document, transfer only allowlisted authentication cookies, and expose a separate clean browser to
the model.

## 2. Replay and video quality

Scout does not record or encode claim-test video. It fetches Firecrawl's replay page metadata and
serves the HLS playlist produced by Firecrawl. Firecrawl's public browser documentation exposes no
recording resolution, bitrate, frame-rate, codec, or quality setting that Scout can request, and the
existing HLS replay requests take no quality input. Player behavior can affect rendition selection
and display, but it cannot reconstruct detail absent from the available source.

Likely improvement paths include:

- Firecrawl adding or enabling a higher-quality recording option;
- Scout transcoding a higher-quality source, if Firecrawl provides one; or
- replacing provider replay with a custom CDP screen recorder.

For the hackathon, Scout keeps the provider replay as evidence and documents that source capture
quality is upstream of Scout's player.

## Short reviewer answer

Scout owns credential storage and the model boundary, but Firecrawl remains trusted for the moment
of browser entry. Scout also displays Firecrawl's HLS replay as supplied, with no documented
recording-quality control. Both are known provider boundaries with clear upgrade paths rather than
hidden claims of stronger guarantees.
