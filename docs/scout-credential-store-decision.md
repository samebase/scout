# Scout managed credentials

**Status:** Implemented for the hackathon with Firecrawl as a trusted credential processor.

**Decision date:** 2026-08-30

Updated for Scout chats on 2026-09-03.

## Decision

Scout generates and stores a managed password in Convex. The model receives only safe account
metadata: the account identifier, service domain, exact login host, and the fact that a managed
password is prepared. Scout never intentionally supplies the model with the password, encrypted
envelope, or credential reference. The hackathon threat model trusts Firecrawl and the target
service not to transform the submitted password into new model-visible content.

Service accounts belong to a Scout. A chat keeps its selected Scout, and its browser uses that
Scout's persistent Firecrawl profile. Registration stores the account and encrypted password
without creating a catalog entry or binding the account to one chat. OAuth accounts reference another
service account owned by the same Scout.

The runtime loads managed credentials for the chat's Scout. At password entry, trusted code selects
the credential whose exact login host matches the current page. The model does not choose a
credential reference or supply a password. A chat can use the Scout's accounts across connected
services in the same conversation.

`prepare_account_password` exposes the same password generation and encrypted registration used by
the profile form. Its inputs are the service name, service domain, and account identifier. Trusted
code derives the scout from the active browser session, re-reads the current HTTPS URL, and requires
the exact host to belong to the requested service domain. Email identifiers must match the scout's
own inbox; a new username may be chosen for signup. Both preparation and commit verify the browser
observation and account binding. Repeated or overlapping preparations keep the first saved password,
account ID, and authentication evidence. The tool returns safe account metadata only.

The password-filling tool is available even when no credential exists yet and reads the current
store when invoked. This permits preparation and filling within the same run without rebuilding
the tool set. Account preparation remains unverified until the authenticated account recorder
succeeds; runtime instructions show that distinction.

When the agent reaches a password form, it calls the existing `fill_account_password` tool with one
visible Playwright target and an optional confirmation-field target. Trusted Node code then:

1. requires the current page to use HTTPS on the credential's exact configured host;
2. resolves only the supplied targets and verifies that each element has type `password`;
3. decrypts the matching Scout credential and checks its authenticated identity fields;
4. registers the plaintext with the browser harness before any fill so later model-visible output
   can redact the exact and URI-encoded forms;
5. fills the verified fields through Firecrawl while recording the field count and browser
   telemetry without the password; and
6. returns only the number of filled fields. The model submits the form separately.

Firecrawl necessarily receives the plaintext password because its API accepts executable commands
rather than an opaque secret handle. That provider trust is an explicit hackathon tradeoff, not an
end-to-end secrecy claim.

## Storage envelope

Passwords use AES-256-GCM in a Convex Node action with:

- a new 96-bit nonce for every encryption;
- a 128-bit authentication tag;
- a 32-byte deployment key in `SCOUT_CREDENTIAL_MASTER_KEY_V1`; and
- authenticated data binding the format, algorithm, purpose, key version and fingerprint,
  credential reference, Scout, service domain, exact login host, and account identifier.

The database stores ciphertext, nonce, tag, safe bindings, and a non-secret key fingerprint. It
does not store the master key. The first credential pins version 1 to that fingerprint. Replacing
the environment key, deleting the key registry while ciphertext remains, or changing authenticated
metadata fails closed. Rotation is not implemented; recovery requires the original environment key
and the Convex data backup.

Public queries expose only safe service-account metadata. A new registration has
`authenticationEvidence.kind` set to `none`. The generated password exists, but the remote account
may still need to be created or have that password set. Successful account observation updates
the authentication evidence and `lastObserved`, which identifies the chat and browser session.

## Browser and model boundary

Managed-credential sessions keep the Scout's persistent Firecrawl profile, operation telemetry,
replay, streamed live view, and human takeover. Managed-password operation records contain the
field count, not the password. Password-entry failures use constant errors, and later model-visible
browser output is scrubbed for the exact password and its URI-encoded representation. The model
submits the form separately after `fill_account_password` succeeds.

The `record_authenticated_service_account` tool accepts the login method, whether the account was
created or recovered, and visible identity and session-control text. OAuth evidence also names the
exact provider account's service domain and identifier. Trusted code re-reads the text and current
URL from the browser. The mutation derives the Scout from the active session and chat, then checks
the latest page observation, the visible account identity, and a Sign out or Log out control.

An existing account is updated in place without changing its credential bindings or OAuth provider
link. A new OAuth record uses the observed service domain and a known Scout username or email.
The provider account must belong to the same Scout. Managed-password accounts must already exist.
The model cannot supply an account ID, Scout ID, session ID, or target service domain to override this
binding. Service-account IDs remain stable when chat history is removed.

Keeping normal observability means provider-rendered replay and live view may capture the remote
browser while a password field is populated. Scout cannot scrub Firecrawl's pixels or prove what
Firecrawl retains. This is documented and accepted for the hackathon rather than presented as a
stronger guarantee.

This is a proportionate hackathon boundary, not a defense against a malicious target site. A page
could transform or split a password before reflecting it, which exact-value scrubbing cannot prove
absent. A stricter production design would perform authentication in an isolated private browser,
close it, transfer only allowlisted authentication cookies into a clean browser, and expose only
that clean browser to the model. See [Firecrawl limitations](./firecrawl-limitations.md).

## Why Convex instead of 1Password

A local compatibility path exists for the official `@1password/sdk` on Convex 1.45.0 when it is
declared in `convex.json` under `node.externalPackages`. A credential-free anonymous local Convex
probe loaded SDK 0.5.0 and its WASM core and generated a 24-character password successfully. The
earlier default bundle probe failed while loading the non-externalized WASM asset; the external
package probe avoided that failure. Hosted deployment compatibility was not tested.

Scout still needs the same trusted Firecrawl broker regardless of whether ciphertext lives in
Convex or an item lives in 1Password. For this hackathon, the encrypted Convex table avoids a second
vendor token, vault lifecycle, and runtime dependency while keeping the implementation auditable.
The relevant Convex mechanism is documented under
[external packages](https://docs.convex.dev/functions/bundling#external-packages).

## Operational rules

- Back up `SCOUT_CREDENTIAL_MASTER_KEY_V1` independently from Convex. Never commit it.
- Do not replace the `_V1` key. Add an explicit versioned rotation procedure before rotating.
- Configure one managed account per Scout and service domain.
- Resolve credentials only from the chat's Scout and the current page's exact HTTPS login host.
- Use the exact login host for credential scope; service-domain normalization may remove `www`.
- Preserve service-account IDs, OAuth provider links, ciphertext, key records, and authenticated
  identity fields when clearing disposable chat history.
- Treat Firecrawl and the target service as trusted during managed-password runs.
- Do not claim that output redaction or Scout telemetry controls prove Firecrawl keeps no
  provider-side records.
