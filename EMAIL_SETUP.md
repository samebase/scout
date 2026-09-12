# Email setup

Scout sends verification and password-reset codes from Convex through Cloudflare Email Service's
REST API. Scout-originated task and human-help emails use the Scout's own AgentMail inbox. The Cloudflare
Worker only hosts the built SPA and has no email binding.

## Cloudflare

1. In Cloudflare Email Service, onboard `samebase.com` for Email Sending.
2. Create an API token with the `Email Sending: Edit` account permission.
3. Keep `scout-notifications@samebase.com` as an allowed sender.

## Convex

Set both values on every Convex deployment that should send authentication email:

```text
pnpm --filter samebase-scout exec convex env set CLOUDFLARE_EMAIL_ACCOUNT_ID "replace-with-account-id"
pnpm --filter samebase-scout exec convex env set CLOUDFLARE_EMAIL_API_TOKEN "replace-with-email-token"
```

Set the production values separately:

```text
pnpm --filter samebase-scout exec convex env set --prod CLOUDFLARE_EMAIL_ACCOUNT_ID "replace-with-account-id"
pnpm --filter samebase-scout exec convex env set --prod CLOUDFLARE_EMAIL_API_TOKEN "replace-with-email-token"
```

The token is a Convex deployment secret. Do not add it to browser variables, Wrangler variables, or
the repository.

## AgentMail

Set an AgentMail API key with `inbox_read`, `message_read`, and `message_send` access on every Convex
deployment. Scout registration looks up the entered inbox ID and rejects it when AgentMail reports a
different email address. Model and Manual sends are then server-bound to that verified inbox.

```text
pnpm --filter samebase-scout exec convex env set AGENTMAIL_API_KEY "replace-with-agentmail-key"
pnpm --filter samebase-scout exec convex env set --prod AGENTMAIL_API_KEY "replace-with-agentmail-key"
```

Every send and reply uses AgentMail's REST API with an idempotency key. Inbox listing, search, and
thread reads continue through AgentMail's hosted MCP server. There is no incoming-email webhook;
Scout reads new messages only when it calls a mail tool.
