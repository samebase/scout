# Public site previews

Public site queries include a stable image URL under `https://scout-media.samebase.com`.
The browser can load it immediately without calling the signed-URL action. Images retain
their original format and size; this change adds no resizing service.

Captures remain in the private workspace bucket. A scheduled Convex action copies a
capture to `scout-public-media` when its site has a public review. Private-only sites
continue using access-checked signed URLs. Removing the last public review deletes the
public copy and purges its exact CDN URL. Each publication uses a new object key so
delayed cleanup cannot delete a newer copy.

## Cloudflare setup

- R2 bucket: `scout-public-media`, Standard storage, Western Europe location hint.
- Public custom domain: `scout-media.samebase.com` (minimum TLS 1.2).
- Create an R2 **Object Read & Write** credential scoped only to this bucket.
- Create a **Zone / Cache Purge** API token scoped only to `samebase.com`.
- Cache Rule `Scout media: respect browser cache headers` matches only
  `http.host eq "scout-media.samebase.com"`, with **Browser TTL: Respect origin** and
  **Eligible for cache**. Edge TTL uses origin cache headers. The zone's browser TTL
  is unchanged.

Objects request `Cache-Control: public, max-age=60, s-maxage=31536000, must-revalidate`:
one minute in browsers and one year at Cloudflare, with explicit CDN purging on removal.
The host rule is necessary: the zone otherwise overrides `max-age=60` to `max-age=14400`.
Verified on September 19, 2026: the custom domain returned `max-age=60` and a CDN cache
hit on the second request. CDN purging cannot clear an already cached browser copy.

The account tokens `Scout public previews - Convex` and `Scout public previews - cache purge`
are configured in production (`usable-spider-599`) and the isolated `wry-canary-235` dev
deployment. A real dev review verified publication to the public bucket, a stable URL in
the anonymous site query, and a CDN cache hit with the requested headers. Making the review
private changed the previously cached URL to `404`; the owner could still fetch the private
original, and anonymous site and signed-URL queries returned `null`. The fixture was removed.

## Convex configuration and rollout

Set these variables on the intended deployment using its dashboard or `convex env set`.
Keep secret values out of source control and command output.

| Variable                         | Value                              |
| -------------------------------- | ---------------------------------- |
| `PUBLIC_MEDIA_BUCKET`            | `scout-public-media`               |
| `PUBLIC_MEDIA_ORIGIN`            | `https://scout-media.samebase.com` |
| `PUBLIC_MEDIA_ACCESS_KEY_ID`     | New bucket-scoped R2 access key ID |
| `PUBLIC_MEDIA_SECRET_ACCESS_KEY` | Matching R2 secret access key      |
| `PUBLIC_MEDIA_ZONE_ID`           | `2f2e7713e926a7282b25796b02826f02` |
| `PUBLIC_MEDIA_CACHE_PURGE_TOKEN` | Zone-scoped purge token            |

The existing `R2_ENDPOINT` and private bucket credentials are still used. Do not widen
the private bucket's access or replace its credentials.

1. Run `pnpm run check` and `pnpm run build`, then validate in an isolated dev deployment.
2. After production deployment is approved, configure its variables and deploy the backend
   and frontend through the normal deployment workflow.
3. In the intended deployment's function runner, call
   `scout/sitePreviewRecords:publishExisting` with
   `{"paginationOpts":{"cursor":null,"numItems":24},"retryFailed":false}`.
   Repeat with the returned `continueCursor` until `isDone` is true. This copies existing
   captures; it does not recapture websites. Check scheduled action results before continuing.
4. Load a published image twice. Verify a `200` image response, `max-age=60`, and
   `CF-Cache-Status: HIT` on the second request. Check the landing page makes no signing
   calls for public previews. Make a dev review private and verify the old URL stops
   serving the image after the deletion and purge finish.

## Manual repair

Publication failures are stored on `sites.preview.publication` and shown to the admin.
After fixing the reported cause, use **Retry preview**, or run `publishExisting` with
`retryFailed: true` to explicitly retry failed publications in a batch.

Deletion or purge failures appear in Convex's scheduled function results and logs, with
the object key and provider diagnostics. After fixing the cause, rerun
`scout/publicSitePreviews:remove` with the failed operation's exact `key`. It is safe to
repeat: old keys are never reused. Never purge the entire zone or delete private captures
to repair a public copy. There is no automatic application retry loop.
