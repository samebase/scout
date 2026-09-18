# Privacy policy

Effective date: September 19, 2026

Scout lets you ask AI agents to explore websites, play browser games, review products, and
carry out online tasks. This policy explains how we handle personal information when you
visit a Scout website or app that links to this policy, create an account, or use Scout.

Public chats can reveal your messages and the Scout's browser activity to anyone. A private
chat limits access to its history, but its Scout can use an inbox, browser profile, and
external accounts shared across chats. Deleting your account currently removes your profile
and sign-in access, but keeps chat and Scout history. These distinctions are explained below.

## Who is responsible

The Samebase team operates Scout. In this policy, "we", "us", and "our" mean the Samebase
team. It is responsible for the processing described in this policy and is the controller
where that term applies.

For privacy questions, requests, or complaints, email contact@samebase.com.

## Information we collect and receive

| Information                               | Examples and sources                                                                                                                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account information                       | The email address and password you provide, email-verification and password-reset records, account identifiers, sign-in sessions, access-approval status, and saved task-engine and Scout preferences. Authentication stores a password hash rather than a readable account password.      |
| Chats and task content                    | Your instructions, messages, submitted URLs, AI responses, summaries, tool inputs and results, files, screenshots, and walkthroughs. Information also comes from websites and services the Scout visits for a task.                                                                        |
| Browser and connected-service information | Visited URLs, page content, browser actions, remote-browser recordings, persistent browser profiles, service-account identifiers, and managed credentials for Scout accounts.                                                                                                              |
| Email and human assistance                | Messages and attachments read or sent through a Scout inbox, recipients and senders, requests for human help, temporary handoff links, and the browser activity associated with a handoff.                                                                                                 |
| Usage and diagnostic information          | Task status, timestamps, selected models, model requests and responses, token and credit usage, provider costs, failures, and operational logs. Our hosting and service providers also receive connection information such as IP addresses and browser information when handling requests. |
| Purchases, when available                 | Credit balances, purchase and checkout identifiers, payment status, amounts, currency, tax and refund amounts. Polar and its payment providers collect payment and billing details at checkout. Scout's payment integration does not receive full payment-card numbers.                    |
| Correspondence                            | Information you send us in support requests, privacy requests, reports, and feedback.                                                                                                                                                                                                      |

Information about other people may appear in a task, website, screenshot, or email even if
they do not have a Scout account. We receive it from the person submitting the task, the
visited service, public web sources, or email correspondents. They can contact us about
their information using the same privacy contact above.

An email address and authentication information are needed to create and secure an account.
Task content is needed to carry out the task you request. Billing information is needed only
for a purchase. You can view public content without creating an account. Do not include
sensitive personal information or other people's private information unless you have a
lawful reason and the task requires it.

## How and why we use information

Where data-protection law requires a legal basis, we use the following bases for these purposes.

| Purpose                                                                                                   | Information used                                                   | Legal basis                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create and operate your account, run requested tasks, maintain task history, and deliver account messages | Account, task, browser, connected-service, and email information   | Performing our contract with you, to the extent this processing is necessary to provide the service you request.                                                      |
| Display a chat you choose to make public                                                                  | The chat and associated task activity described below              | Performing the public-sharing feature you request, where necessary to our contract. Your choice does not authorize publication of someone else's private information. |
| Process credit purchases and maintain balances, when enabled                                              | Account identifiers, usage, and transaction information            | Performing our contract; legal obligations for records we must keep.                                                                                                  |
| Approve access, investigate faults, prevent abuse, secure Scout, and answer support requests              | Account, diagnostic, correspondence, and relevant task information | Our legitimate interests in operating a reliable service, controlling access, and protecting users and systems, balanced against the people affected.                 |
| Handle legal requests, privacy rights, and disputes                                                       | The information relevant to the request or dispute                 | Applicable legal obligations; legitimate interests in establishing, exercising, or defending legal claims where appropriate.                                          |

The contract basis does not automatically cover information about people who are not parties
to that contract. For incidental third-party information needed for a task, we assess our
and the requesting user's legitimate interests in carrying out authorized tasks against the
rights of the people concerned. This is not permission to collect or expose information
without a lawful basis.

This policy is a notice, not a request for blanket consent. If a feature needs consent, we
will ask separately and explain how to withdraw it. Account, security, and billing messages
are part of operating the service. We do not treat a Scout account as permission to send
optional marketing emails or record your use of our website for optional analytics.

## AI processing and automated checks

AI providers receive the context needed to answer or act on a request. This can include
instructions, conversation history, summaries, website content, screenshots, email content,
and tool results. Choosing a model can change which provider receives that context.

Scout uses OpenAI directly for its Agents API and request checks. Other model calls use the
Convex AI Gateway, with OpenAI, Qwen, and DeepSeek model options. Model names do not by
themselves identify the company hosting a model. The gateway and the providers serving the
selected model can process that task context under their applicable service terms and data
controls. We do not train our own AI models on your task content. Provider retention and
permitted uses vary by service; we do not promise that every model or tool has the same
retention period or data-use settings.

Scout stores task history and model-call information so tasks can continue and their results
can be inspected. A short-lived browser session or a provider's no-training setting does not
mean the task history is immediately deleted.

Automated checks can approve or reject task requests or decide whether a task can resume.
Account approval is handled by administrators. Email contact@samebase.com if you believe a
check made a mistake and would like a person to review it.

## Public chats, private chats, and shared Scouts

If you make a chat public, visitors can view its conversation and associated activity,
including tool results, screenshots, walkthroughs, and available live-browser views or
replays. Information shown on a visited website can appear in that material. Public content
may be copied by others or indexed by search engines. Changing visibility cannot retrieve
copies other people have already made.

Private chats are not listed for public viewing. Authorized operators and administrators can
access information needed to run, inspect, and support Scout. Providers still process private
task content. Private chats are not end-to-end encrypted.

A Scout is a persistent identity with its own inbox, browser profile, and service accounts.
Those resources can be reused across chats and by different authorized users. A later task
may encounter email, logged-in sessions, or changes left by an earlier task. Private chat
visibility does not make these shared external resources exclusive to you. Use test accounts
and data suitable for that shared environment.

Remote-browser recordings show the browser the Scout uses. They are distinct from analytics
recordings of your own device. During a human handoff, activity in that remote browser can
also be captured. A person with a valid handoff link can access the designated browser during
its access window, so treat the link as confidential.

## Who receives information

| Recipient                                                 | What it does and the information involved                                                                                                                                                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Convex                                                    | Hosts Scout's backend, database, authentication, task history, and some site delivery. Its AI Gateway also handles model requests.                                                                                                 |
| Cloudflare                                                | Delivers the website, stores workspace files and screenshots in R2, and sends account-verification and password-reset emails. It handles the relevant content and network information.                                             |
| OpenAI and the providers serving gateway models           | Generate responses, operate agents, and evaluate task requests using the task context sent to them.                                                                                                                                |
| Firecrawl                                                 | Searches and reads websites, runs remote browsers and persistent profiles, and provides screenshots, live views, and replays. It receives visited content and browser commands.                                                    |
| AgentMail                                                 | Hosts Scout inboxes and handles messages, attachments, addresses, and delivery information used by email tasks and human handoffs.                                                                                                 |
| Polar and its payment providers, when checkout is enabled | Sell credit packs through checkout and handle payment, billing, tax, fraud prevention, and refunds. Polar acts as the merchant of record for those sales and processes information for its own legal and payment responsibilities. |

Websites the Scout visits and people it emails receive the information submitted to them.
Their own privacy practices govern their independent use of that information. Public viewers
receive the content you make public. Authorized operators receive information needed for
administration, security, and support.

We may disclose relevant information when legally required or when reasonably necessary to
address fraud, protect people's safety, or establish or defend legal claims.

We do not sell personal information or share it for cross-context behavioral advertising.

## International processing

Providers may process information outside your country, including in the United States and
other countries where they and their subprocessors operate. An EU database region does not
mean that all AI, browser, email, support, or payment processing stays in the EU. Processing
locations and transfer protections depend on the provider, service, and resource location.
Where data-protection law restricts international transfers, the transfer must have a valid
legal basis and any safeguards that law requires. Accepting our terms does not waive those
requirements or constitute consent to an otherwise unlawful transfer.

You can email contact@samebase.com for information about the safeguards applicable to your
data and a copy where the law entitles you to one.

## Browser storage

Scout uses local browser storage to keep you signed in and remember sidebar layout choices.
Signing out removes the stored authentication tokens; layout preferences remain until
replaced or cleared. You can clear site data in your browser settings, which may sign you
out and reset preferences.

The current Scout application does not include advertising trackers or a visitor-analytics
session-replay SDK. Infrastructure, checkout, and embedded providers may use their own
storage when you interact with those services. Their notices and controls apply to their
independent processing. Where optional storage or tracking on Scout requires consent, we
will ask before enabling it; you can refuse or withdraw that consent.

Websites opened inside a Scout's remote browser can set cookies in that remote browser's
persistent profile. Those cookies can outlive an individual task. They are separate from
storage in your own browser.

## Retention and deletion

Deleting your account in Settings starts removal of your profile and authentication records
and blocks further account access. When cleanup finishes, a minimal record containing the
account identifier and creation and deletion timestamps remains.

**Account deletion currently keeps chats, messages, files, screenshots, task records, and
shared Scout history.** It also keeps shared Scout inboxes, browser profiles, external
accounts, and credit or purchase records. Retained records remain linked to the deleted
account identifier. A "Deleted account" label does not anonymize personal information inside
those records. Existing chat visibility continues to apply.

The current application does not automatically expire retained chat and task history.
We determine how long information is needed using these criteria:

- Account and authentication records support an active account and are removed through the
  account-closure process described above.
- Task content, files, recordings, and shared-resource history support continued tasks,
  published results, and investigation of previous actions. They can remain after account
  closure and have no fixed automatic expiry; continued retention remains subject to
  necessity and applicable deletion rights.
- Usage, payment, and refund records support balances, reconciliation, disputes, fraud
  prevention, and applicable tax or accounting obligations.
- Security logs, support correspondence, deletion records, and legal-request records are
  kept while needed to investigate the relevant matter, protect the service, demonstrate
  compliance, or establish or defend claims, including applicable limitation periods.

We remove or de-identify personal information when it is no longer needed for a lawful
purpose. This may require manual cleanup; account closure does not trigger that cleanup for
all retained content.

To request erasure of personal information in retained content, email contact@samebase.com.
This is separate from closing your account. We will assess the request under applicable
law, remove information where required, and explain any lawful reason for keeping particular
records. Public sharing and shared history do not remove your data-protection rights.

Provider backups, security records, AI application state, browser recordings, and email copies
may have separate retention periods under the relevant provider's terms, backup lifecycle,
security needs, and legal obligations. Removing an active record does not instantly erase
every backup or revoke credentials at an external service. When a deletion request covers
information held by our processors, we address those copies as required by law and explain
any applicable exception. Recipients may keep messages or public copies independently; we
cannot guarantee that copies outside our control disappear.

## Security

Scout uses access controls and encrypted connections. Managed passwords for Scout service
accounts are encrypted in storage, but the browser provider and destination website receive
them when a login is performed. Recordings and page content can still expose sensitive
information. No security measure guarantees complete protection.

Do not put passwords, API keys, payment-card details, or other secrets in chat messages or
public tasks. Use only the credential features intended for Scout accounts.

## Your rights

Depending on the law that applies, you may request access to your personal information,
correction, deletion, restriction of processing, or a portable copy. You may object to
processing based on legitimate interests. Where we rely on consent, you can withdraw it
without affecting the lawfulness of earlier processing. Rights and exceptions depend on the
circumstances.

Send requests to contact@samebase.com. You do not need an active Scout account. We may ask for
proportionate information to verify your identity and locate the records. We respond within
the applicable legal deadline. Under the EU GDPR, this is normally one month, with extensions
permitted in specified cases; we will explain an extension within that first month.

You can also complain to the relevant data-protection authority without contacting us first.
In the EEA, you can contact the authority where you habitually live or work, or where the
alleged infringement occurred. The European Data Protection Board maintains a
[directory of EEA authorities](https://www.edpb.europa.eu/about-edpb/our-members_en).
In the UK, you can [complain to the Information Commissioner's Office](https://ico.org.uk/make-a-complaint/).
Elsewhere, contact the data-protection regulator with jurisdiction over your complaint.

## Age and changes to this policy

Scout is intended for adults aged 18 or older. If you believe a child has provided personal
information, contact us so we can investigate and take appropriate action.

We will publish updates with a new effective date and give appropriate notice of material
changes. A policy update does not by itself authorize a new use of information or replace
consent where consent is required.
