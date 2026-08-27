# Cloudflare email setup

Scout sends verification and password-reset codes from Convex through Cloudflare Email Service's
REST API. The Cloudflare Worker only hosts the built SPA and has no email binding.

## Cloudflare

1. In Cloudflare Email Service, onboard `samebase.com` for Email Sending.
2. Create an API token with the `Email Sending: Edit` account permission.
3. Keep `scout-notifications@samebase.com` as an allowed sender.

## Convex

Set both values on every Convex deployment that should send authentication email:

```text
pnpm exec convex env set CLOUDFLARE_EMAIL_ACCOUNT_ID "replace-with-account-id"
pnpm exec convex env set CLOUDFLARE_EMAIL_API_TOKEN "replace-with-email-token"
```

Set the production values separately:

```text
pnpm exec convex env set --prod CLOUDFLARE_EMAIL_ACCOUNT_ID "replace-with-account-id"
pnpm exec convex env set --prod CLOUDFLARE_EMAIL_API_TOKEN "replace-with-email-token"
```

The token is a Convex deployment secret. Do not add it to browser variables, Wrangler variables, or
the repository.
