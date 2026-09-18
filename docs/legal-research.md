# Scout privacy and terms research

Researched September 18, 2026 against the current checkout and the primary sources linked
below. This is an implementation-informed drafting record, not a jurisdiction-specific legal
opinion. Have a qualified adviser review applicability and the final text for the operator's
country and intended markets before publication.

## Deliverables and scope

- [Privacy policy draft](../apps/scout/src/content/privacy-policy.md), intended for `/privacy`.
- [Terms and conditions draft](../apps/scout/src/content/terms-of-service.md), intended for `/terms`.

The Markdown lives in the app's content directory so the future routes can render the same
files. Neither page is routed, published, or effective yet. There are no application behavior
changes in this work.

The drafts describe the current product, including public tasks, shared Scouts, AI providers,
remote-browser recordings, and account closure that retains history. They cover optional paid
credit packs because the code already supports Polar checkout. No live deployment settings,
provider dashboards, signed contracts, or existing customer records were inspected.

Scout uses the same operator and public contact as Samebase, as requested by the operator:
"the Samebase team" and `contact@samebase.com`. The wording follows
`~/dev/samebase/samebase/apps/samebase/src/content/privacy-policy.md` and
`~/dev/samebase/samebase/apps/samebase/src/content/terms-of-service.md`. The governing-law
clause also follows Samebase's operator-based wording. No personal address is requested or
included. Intended markets and applicable legal requirements still need to be assessed.

## What the research changes about the draft

### A free or experimental service still needs accurate disclosures

Revenue is not the test for GDPR territorial scope. EU establishment, offering services to
people in the EU, or monitoring their behavior can bring processing into scope. Merely being
reachable from the EU does not settle that question. Confirm establishment and intended
markets before selecting applicable law. See the European Commission's
[explanation of GDPR scope](https://commission.europa.eu/law/law-topic/data-protection/data-protection-explained_en).

If the operator is in Moldova, assess the current local law. The Moldovan regulator confirms
that Law 195/2024 took effect on August 23, 2026. Do not use an older template that treats it
as a future law. Operator location has not been inferred from the computer's timezone. See
[the regulator's commencement notice](https://datepersonale.md/23-august-2026-un-nou-reper-pentru-protectia-datelor-cu-caracter-personal-in-republica-moldova/).

EU digital-service consumer rules can also cover services supplied for personal data, subject
to an exception when the data is used exclusively to deliver the service or meet legal
requirements. Free access is not a blanket exemption. See Article 3 of
[Directive 2019/770](https://eur-lex.europa.eu/legal-content/en/ALL/?uri=CELEX%3A32019L0770).

### Write a notice about real processing, not a consent waiver

Identify the operator, information and sources, purposes, legal bases, recipients,
international transfers, retention, rights, and contact process. Explain required information
and the consequences of not providing it. Include people whose data arrives through email,
websites, and other users. Articles 13 and 14 address direct and indirect collection in the
[GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/).

Short sections and concrete examples help users find the relevant information. Keep notice
delivery close to collection, and keep any consent separate from terms acceptance. The ICO's
[privacy-information checklist](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/)
is a useful drafting aid, not evidence that UK law necessarily applies to Scout. That page
itself flags ongoing updates following changes to UK law.

The proposed purposes distinguish contract performance, legitimate interests, and legal
obligations. These are proposed legal assessments, not conclusions proved by code. Record
necessity and balancing for security, support, and incidental third-party data. A user's
contract does not supply a legal basis for processing everyone else's data. The ICO explains
the assessment in its [legitimate-interests guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/legitimate-interests/).

If Scout processes organizational customers' personal data on their instructions, separately
assess controller and processor roles and whether a customer data-processing agreement is
needed. The public privacy notice does not replace one. Review Article 28 of the
[GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/).

### Account closure is not erasure or anonymization

The current deletion workflow scrubs the profile and authentication records but retains
history, files, shared resources, and credit records. Retained transcripts can contain names,
email addresses, screenshots, and other identifying details. Labeling the owner "Deleted
account" does not make that content anonymous.

Describe this behavior prominently, but do not present disclosure as permission to keep all
personal data forever. Define necessary retention periods or meaningful criteria and a
separate erasure-request process. See the ICO's
[storage-limitation guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/)
and the Commission's [summary of individual rights](https://commission.europa.eu/law/law-topic/data-protection/information-individuals_en).

A proportionate first operational design is a monitored request inbox and documented manual
cleanup, with checks across the database, files, providers, and public views. It does not
require a new automated repair system. It does require someone able to complete a request
and explain lawful exceptions. Test that process before promising it to users.

### Keep consumer terms proportionate

Explain the service, eligibility, authorization for external actions, public sharing, content
rights, prices and metering, refunds, suspension, and ending use. Avoid blanket "no refunds",
unlimited indemnities, total exclusion of liability, and arbitrary retroactive changes.
The Commission explains why language and substantive fairness both matter in its
[unfair-contract-terms guidance](https://commission.europa.eu/law/law-topic/consumer-protection-law/consumer-contract-law/unfair-contract-terms-directive_en).

Polar's current [buyer terms](https://polar.sh/legal/checkout-buyer-terms) distinguish its
merchant-of-record sale from the supplier's terms for using the product. Scout still needs
its own service terms and support process. The draft uses conditional one-time credit
purchases, not an invented subscription or a promise that Scout will stay free.

Classify credits and their underlying service before implementing withdrawal consent. The
rules for immediate digital-content delivery and service performance differ; accepting
general terms is not the required separate express request or acknowledgment. See the
Commission's [contract-information guidance](https://commission.europa.eu/system/files/2019-07/sr_information_presentation.pdf).

There is also a current implementation issue: the EU amendment introducing an online
withdrawal function applies through national measures from June 19, 2026. Where applicable,
an email address alone is not the whole checkout design. Establish whether Polar supplies
the required function for the sale and what Scout must provide. See Article 11a inserted by
[Directive 2023/2673](https://eur-lex.europa.eu/eli/dir/2023/2673/oj).

### Browser storage and AI need specific explanations

Authentication and layout use local storage. Local storage is covered by storage/access rules
just as cookies can be; classify each purpose and any exemption before deciding whether a
consent interface is needed. Do not add a decorative cookie banner or claim "no cookies"
based only on an application-code search. See the ICO's
[storage and access guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-storage-and-access-technologies/).

The app's remote-browser replay is a task artifact. It is different from recording visitors'
interactions with Scout through an analytics SDK. The draft makes that distinction, while
requiring a real deployed-browser audit for injected scripts, embedded providers, and checkout.

Clearly identify Scouts as AI at the point of interaction, as well as in the terms. Assess
the EU AI Act's applicable transparency duties for both the chat and external communications;
Article 50 requirements began applying on August 2, 2026, with details and exceptions to check
against the actual feature. See the Commission's
[transparency guidance](https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-transparency-obligations).

The public feed also warrants a scoped review of Digital Services Act duties, including
reporting and contact mechanisms where applicable. Small size does not answer every scope
question. The draft offers a reporting contact but does not claim that this completes DSA
compliance. See the Commission's [user-rights overview](https://digital-strategy.ec.europa.eu/en/factpages/user-rights-under-digital-services-act).

The proposed 18+ limit is a product choice for this experimental service, not a legal finding
or an implemented age check. A games feature needs an audience assessment: writing "18+"
does not by itself settle whether a service is directed to children. See the FTC's
[COPPA guidance](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions).
Assess any US state-law disclosures against actual applicability, rather than pasting in a
California supplement; the [California regulator's FAQ](https://cppa.ca.gov/faq) explains its
threshold-based scope.

## Implementation evidence

Paths below are relative to `apps/scout/` unless stated otherwise.

| Topic                         | Observed evidence                                                                                                                                                  | Drafting consequence                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signup and approval           | `src/components/auth-panel.tsx`, `convex/auth.ts`, `convex/authEmails.ts`, `convex/accounts.ts`                                                                    | Email/password registration, verification and reset codes, manual approval, and saved task-engine/Scout preferences. No terms-version acceptance or age declaration found in signup.                                               |
| Authentication and UI storage | `src/lib/convex.tsx`, installed `@convex-dev/auth/src/react/client.tsx` and `providers/Password.ts`, `src/sidebars/scoutSidebarState.ts`                           | Default password hashing and local-storage authentication tokens; persistent sidebar layout. No visitor-analytics SDK found in authored frontend code or declared dependencies.                                                    |
| Public and private access     | `convex/scout/chats.ts`, `convex/scout/chatAccess.ts`, `convex/tasks/access.ts`, `convex/browserReplay.ts`                                                         | Public viewing exists; owner/admin permissions govern other access. Making a chat public is a real disclosure, including associated browser activity.                                                                              |
| Shared Scouts and secrets     | Repository `docs/agent-runtime.md` and `docs/scout-credential-store-decision.md`; `convex/scout/credentialCrypto.ts`                                               | Persistent inboxes, profiles and accounts; encrypted managed passwords still reach Firecrawl and destination sites. No guarantee of redaction from provider pixels.                                                                |
| Task and AI records           | `convex/schema.ts`, `convex/scout/models.ts`, `convex/tasks/client.ts`, `convex/tasks/agentsApi.ts`, `convex/tasks/convexAgent.ts`, `convex/tasks/requestCheck.ts` | OpenAI direct and Convex Gateway paths; OpenAI, Qwen, DeepSeek model options; stored prompts, responses, summaries and request-check evidence. A request check's `store: false` is not an app-wide deletion policy.                |
| Files and screenshots         | `convex/workspaceStorage.ts`, `convex/scout/workspaces.ts`, `convex/tasks/screenshots.ts`                                                                          | Convex metadata and Cloudflare R2 bytes. File permissions are separate from public chat display, but a file's contents may be copied into visible tool results.                                                                    |
| Email and browser vendors     | `convex/email.ts`, `convex/scout/lib/agentMail.ts`, `convex/tasks/tools.ts`, `convex/scout/lib/firecrawlReplay.ts`                                                 | Cloudflare sends authentication email; AgentMail handles Scout inboxes; Firecrawl handles research, browsers and replay. Do not list Resend, PostHog, or 1Password as Scout integrations merely because another project uses them. |
| Handoffs                      | `convex/humanHandoffs.ts`, `convex/humanHandoffBrowser.ts`, repository `docs/agent-runtime.md`                                                                     | Temporary links grant access to the remote browser; handing control to a person does not stop recording.                                                                                                                           |
| Account deletion              | `convex/accountDeletion.ts`, `convex/accountDeletionCleanup.ts`, `src/routes/account-deletion.tsx`, repository `docs/account-deletion-rfc.md`                      | Authentication and profile deletion; persistent minimal user record; retained task content and shared resources. No full personal-data erasure workflow or general content expiry found.                                           |
| Payments                      | `convex/creditPolicy.ts`, `convex/creditLedger.ts`, `convex/polar.ts`, `convex/polarConfig.ts`, `convex/creditPurchases.ts`, `src/components/credits-panel.tsx`    | Separate usage and checkout flags. Current offer is 200 credits for USD 5 before tax, with 50 signup credits. Usage settles asynchronously, can go negative, and refunds adjust credits. Live flags were not inspected.            |

## Provider findings and remaining verification

| Provider   | Primary source and finding                                                                                                                                                                                                                                                                                   | Still needed before a final privacy claim                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Convex     | [AI Gateway documentation](https://docs.convex.dev/ai-gateway/overview), [DPA](https://www.convex.dev/legal/dpa), [subprocessors](https://www.convex.dev/legal/subprocessors). The gateway forwards model requests. The DPA addresses transfers and deletion with backup exceptions.                         | Confirm the contracted entity, deployment region, backup retention, and gateway's actual serving providers and terms. The published subprocessors list inspected did not resolve the Qwen/DeepSeek serving chain.                        |
| OpenAI     | [API data controls](https://developers.openai.com/api/docs/guides/your-data). API content is not used for training by default unless opted in; abuse monitoring and endpoint-specific application state have separate retention. The current table lists Agents application state as retained until deleted. | Verify organization sharing settings, applicable API endpoints and region, and removal of provider sessions. Do not describe all data as deleted after 30 days or assume a gateway account uses the same settings as the direct account. |
| Cloudflare | [Privacy policy](https://www.cloudflare.com/privacypolicy/) identifies customer-controlled end-user processing separately from its own uses.                                                                                                                                                                 | Verify Workers, R2, Email Sending, logs, storage jurisdiction, deletion and contract coverage for each service. An EU Convex URL says nothing about all Cloudflare processing.                                                           |
| Firecrawl  | [Privacy policy](https://www.firecrawl.dev/privacy-policy), plus its [zero-retention explanation](https://www.firecrawl.dev/glossary/web-scraping-apis/zero-data-retention-web-scraping). The latter describes an enterprise option for scrape, crawl and search.                                            | Verify the actual plan, DPA, browser-profile and replay retention, countries, and deletion APIs. Do not extend an enterprise scraping claim to hosted browser recordings.                                                                |
| AgentMail  | [Privacy policy](https://www.agentmail.to/legal/privacy) describes US processing and distinct retention for messages, logs and backups. Raw message/attachment objects and some received-message logs have no configured automatic expiry.                                                                   | Confirm the applicable DPA and how removal covers raw objects, attachments, shared inboxes and backups. Deleting a Scout login does not delete a shared mailbox.                                                                         |
| Polar      | [Buyer terms](https://polar.sh/legal/checkout-buyer-terms) and [privacy policy](https://polar.sh/legal/privacy-policy) explain the reseller relationship and billing processing.                                                                                                                             | Verify production enablement, merchant approval, withdrawal flow, refund handling, and legal/accounting retention. Do not describe Polar solely as Scout's processor.                                                                    |

Convex's legal pages render their documents in an inline frame. The DPA and subprocessors
text was read from that frame's HTML because the search reader returned only the page shell.
Public provider documentation does not prove which contracts or settings apply to this account.

## Finish before publication

| Decision or work               | What must be settled                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Publication and scope          | Replace `SERVICE_URLS` and `EFFECTIVE_DATE`. Use the Samebase team and `contact@samebase.com` for the operator and contact, as requested. Select the relevant authority and assess any representative or DPO requirements against the intended markets.                                                                                                |
| Provider processing            | Resolve `AI_PROVIDER_AND_DATA_USE_DETAILS`, `PROCESSING_COUNTRIES_AND_TRANSFER_SAFEGUARDS`, and `PROVIDER_DELETION_AND_BACKUP_DETAILS`. Confirm each enabled model's serving entity, data uses, countries, contracts and retention. Disable an unverified route if it cannot support the notice that will be published.                                |
| Retention and rights           | Replace `RETENTION_SCHEDULE` with category-specific periods or meaningful criteria, including after account closure. Establish and test access, correction and erasure handling, including provider copies and public content. Indefinite retained history needs a product decision, not softer wording.                                               |
| Optional data uses and storage | Resolve `OPTIONAL_DATA_USE_DETAILS`, `SALE_AND_ADVERTISING_DETAILS`, and `BROWSER_STORAGE_AUDIT_DETAILS`. Confirm no off-code marketing, sale/sharing, analytics or training arrangements; inspect signed-out, signed-in, live-view and checkout network/storage behavior.                                                                             |
| Credits and refunds            | Resolve `CREDIT_METERING_DISCLOSURE` with the current conversion, metered items, rounding and variable provider rates, and make the information accessible before purchase/use. Confirm current expiry behavior and the proposed refund approach. Complete applicable withdrawal information and interface requirements before enabling paid checkout. |
| Audience and agreement         | Confirm the proposed 18+ restriction and audience design. Add explicit terms acceptance and save the accepted version/time. Give existing users appropriate notice and renewed acceptance where needed. Staff must be able to fulfill the draft's reporting and human-review commitments.                                                              |

`SUPERVISORY_AUTHORITY_DETAILS` is also a publication placeholder. The authority information
should name the relevant body and link to its complaint process while preserving other
applicable complaint rights. Add representative or DPO details only if applicable; no such
appointment is established by the existing Samebase documents.

For a starting retention discussion, consider private task content for a fixed period after
last activity, public content while deliberately published with periodic necessity review,
short operational-log retention, and separate statutory transaction retention. Pick actual
periods with the operator and provider evidence. These are recommendations, not implemented
expiry rules or promises in the drafts.

Proposed contractual choices also need confirmation: adults only, no scheduled credit expiry,
case-by-case refunds outside statutory rights, no mandatory arbitration, and no invented
monetary liability cap. Local legal review should focus on these choices and the mandatory
consumer protections.

## Route integration after the text is finalized

1. Render these Markdown sources at public `/privacy` and `/terms` TanStack Router routes.
   Enable Markdown table support. Add document titles, readable line lengths, heading anchors,
   and links between the pages.
   Keep the source files as the single copy of the text and show the approved effective date.
2. Link both pages from public navigation, Settings, and signup before information is submitted.
   Keep them readable while signed out, pending approval, or closing an account. The current
   `RouteAccessOutlet` redirects deleting/deleted accounts except on `/account-deletion`, so
   simply setting the new routes to `access_public` is not enough for that case.
3. Add an unselected agreement control or equally clear affirmative signup action linked to
   the terms, with version/time recorded on the backend. Treat the privacy notice as information;
   collect any optional consent separately. Provide a path for existing accounts as appropriate.
4. Put concise disclosures at the decision points: public sharing, shared Scout resources,
   remote-browser recording/handoff, and buying or spending credits. Link to the full details.
5. Verify the Markdown rendering and links, direct navigation and reload, keyboard/mobile access,
   signed-out and deleted-account access, and signup agreement behavior. If navigation changes
   affect sibling task/site layouts, follow the repository's delayed-query/sidebar checks.
6. Remove all draft markers and placeholders only after the corresponding facts and behavior
   are settled. Archive the effective versions when the terms change.
