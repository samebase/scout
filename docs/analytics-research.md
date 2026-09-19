# Scout analytics and session recording

Researched and configured September 19, 2026. Samebase's existing integration is the
reference. Use PostHog; no separate database activity report is part of this work.

## Project and cost

Scout has a separate [EU Cloud project](https://eu.posthog.com/project/279067) in the existing
PostHog organization. The organization is on pay-as-you-go. The saved Product Analytics
billing limit is $10 per month. Session Replay has a $0 limit, so it is limited to the free
allowance. These limits apply per product across the organization, including Samebase; they
are not an organization-wide $10 ceiling. Other products have separate limits.

PostHog currently includes 1 million analytics events and 5,000 recordings per month free.
Paid usage starts after the free allowance, subject to the product limit. A billing limit
is a usage guard, not a promise that every fee, tax, or other product is included.
See [pricing](https://posthog.com/pricing) and the
[organization billing page](https://eu.posthog.com/organization/billing/overview).

This is a better fit than adding another analytics vendor: Samebase already uses PostHog,
and pageviews, account identity, and recordings are available together. Plausible is useful
for aggregate traffic but deliberately avoids persistent visitor identity. Clarity adds
replay but would introduce another provider and consent integration.
See [Plausible's data policy](https://plausible.io/data-policy) and
[Clarity's consent documentation](https://learn.microsoft.com/en-us/clarity/setup-and-installation/consent-mode).

## Account experience

The recording checkbox is separate from required terms acceptance, optional, and initially
unchecked at signup. Existing accounts have recording off until they opt in through
Settings. The account stores the decision, server timestamp, source, consent-text version,
and latest grant. Withdrawal stops recording in the current tab immediately, and the saved
preference propagates through Convex subscriptions to other connected tabs. Logout, account
switching, unresolved preferences, and deletion stop recording.

The implementation follows Samebase's distinction: basic pageviews and signed-in account
IDs are independent of recording consent. No email or name is sent to PostHog. Route
templates omit task IDs, query strings, and fragments. Automatic click events, exceptions,
heatmaps, feature flags, and surveys are disabled. The integration uses no persistent
analytics identifier in cookies or local storage and respects Do Not Track.

## Legal assessment

A separate checkbox can provide a specific recording choice. Acceptance of terms is not
blanket consent. Refusal must not prevent account access, and withdrawing must be easy.
See [EDPB consent guidance](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_202005_consent_en.pdf)
and [GDPR Articles 6 and 7](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng).

**Samebase's existing behavior is not proof that identified analytics can run without
consent everywhere.** Device-access rules and processing personal data are separate legal
questions. Disabling cookies does not create a universal exemption. The operator's
establishment and intended markets remain unconfirmed, and a legitimate-interest assessment
for account-linked browser analytics has not been completed in this task. Where prior
consent is required for those analytics, they must also be gated before release there.
The privacy notice describes the actual separation; it does not establish an exemption.
See the EDPB's [technical-scope guidance](https://www.edpb.europa.eu/documents/guideline/guidelines-22023-on-technical-scope-of-art-53-of-eprivacy-directive_en)
and [ICO statistical-measurement exceptions](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/).

UK statistical exemptions concern limited aggregate measurement, not a blanket right to
build individual browsing histories. CNIL's 2026 session-replay document reviewed here is
a [draft consultation](https://cnil.fr/en/session-replay-cnil-launches-public-consultation-its-draft-recommendation),
not a final new legal requirement.

The operator should verify the PostHog processor agreement and applicable international
transfer safeguards. No new agreement was signed on the user's behalf.
See [PostHog's privacy and DPA guidance](https://posthog.com/docs/privacy).

## Recording boundaries

The project uses total text/image masking. The client also masks inputs, text, and DOM
attributes except interface CSS classes, and blocks code, images, embedded browsers, media,
canvas, and authentication forms. Static styles preserve the surrounding interface layout.
Account/billing settings, administration, deletion, and handoff pages are excluded from
recording. Handoff analytics events are dropped as well. Network and console capture are
disabled both in the project and client. These strict settings reduce replay detail.
See [replay privacy](https://posthog.com/docs/session-replay/privacy),
[network recording](https://posthog.com/docs/session-replay/network-recording), and the
[JavaScript configuration](https://posthog.com/docs/libraries/js/config).

Replay retention is set to 30 days. This setting concerns future recordings; deletion can
take additional processing time. Analytics retention is separate. Account closure currently
does not erase PostHog data automatically; privacy requests require looking up the internal
account ID in PostHog and deleting the relevant data there.
See [recording retention](https://posthog.com/docs/session-replay/recording-retention).

Scout's own remote-browser recordings remain distinct from recordings of people using the
Scout website. The optional checkbox governs only the latter.

## Deployment

Set `VITE_PUBLIC_POSTHOG_PROJECT_TOKEN` in the frontend build environment to the Scout
project's public ingestion token. The ingestion endpoint is `https://eu.i.posthog.com`.
This is a public write-only project token, not a personal API key. Leave the token unset in
ordinary development and previews to keep test traffic out of production reports. The
dedicated local verification environment is explicitly configured with the token.

Before release, run `pnpm run check` and `pnpm run build`; verify signup both ways,
Settings withdrawal, navigation, account switching, and masking with synthetic data.

## Verification in this change

Repository checks pass: 1,430 tests, with 11 existing skips. The static build passes.
Chrome verified unchecked signup consent, saving in Settings, persistence across reload,
withdrawal, and sign-out against a dedicated Convex development deployment. Chrome reported
an analytics opt-out, which the integration respected; live PostHog ingestion and replay
playback were therefore not verified in that browser. Synthetic tests use the real SDK
with a mocked transport and the bundled recorder to verify event filtering and DOM masking,
including later mutations. Production has not been deployed or configured with the token.

The PostHog legal dashboard showed no generated agreements. Legal entity details have been
requested so a DPA can be prepared for approval.
