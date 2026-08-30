# Scout managed credentials

**Status:** Implemented for the hackathon with Firecrawl as a trusted credential processor.

**Decision date:** 2026-08-30

## Decision

Scout generates and stores a managed password in Convex. The model receives only safe account
metadata: the account identifier, product domain, exact login host, and the fact that a managed
password is prepared. Scout never intentionally supplies the model with the password, encrypted
envelope, or credential reference. The hackathon threat model trusts Firecrawl and the target
service not to transform the submitted password into new model-visible content.

An account-creation run cannot start until application code receives one exact
`serviceAccountId`. The backend verifies that the account is managed and belongs to the selected
Scout and Product, then stores the ID on the run. Continuations and later browser sessions resolve
that same ID; there is no ambient Scout-and-domain credential lookup.

When the agent reaches a password form, it calls the existing `fill_account_password` tool with one
visible element ref and an optional confirmation-field ref. Trusted Node code then:

1. requires the current page to use HTTPS on the credential's exact configured host;
2. resolves only the supplied refs and verifies that each element has type `password`;
3. decrypts the password using the envelope attached to the run's exact service-account ID;
4. registers the plaintext with the browser harness before any fill so later model-visible output
   can redact the exact and URI-encoded forms;
5. fills the verified fields through Firecrawl while persisting only refs and character counts in
   Scout's operation telemetry; and
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
  credential reference, Scout, product domain, exact login host, and account identifier.

The database stores ciphertext, nonce, tag, safe bindings, and a non-secret key fingerprint. It
does not store the master key. The first credential pins version 1 to that fingerprint. Replacing
the environment key, deleting the key registry while ciphertext remains, or changing authenticated
metadata fails closed. Rotation is not implemented; recovery requires the original environment key
and the Convex data backup.

Public queries expose only safe service-account metadata. A registration has status `prepared`:
the generated password exists, but the remote account may still need to be created or may already
need that password set. Authentication evidence remains `none` until a journey can record a real
success or failure.

## Browser and model boundary

Managed-credential sessions keep the run's selected persistent Firecrawl profile, operation
telemetry, replay, streamed live view, and human takeover. Scout's structured telemetry never stores
form values. Provider failures after secret use are replaced with constant errors, and later
model-visible browser output is scrubbed for the exact password and its URI-encoded representation.
The parallel auto-submit tool and its serialized browser script were removed; the runtime has one
password capability with the same ref-based conventions as the other browser tools.

The account-recording tool accepts only whether the account was created or recovered and refs for
the visible identity and session control. Trusted code resolves the expected identifier from the
Run's bound `serviceAccountId`, verifies that the visible identity contains it, and updates only that
account. The model cannot select an account by repeating an identifier.

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
- Configure one managed account per Scout and product domain.
- Bind the exact managed service-account ID before starting an account-creation run; never select a
  runtime credential from an ambient Scout-and-domain match.
- Use the exact login host for credential scope; product grouping may separately remove `www`.
- Treat Firecrawl and the target service as trusted during managed-password runs.
- Do not claim that output redaction or Scout telemetry controls prove Firecrawl keeps no
  provider-side records.
