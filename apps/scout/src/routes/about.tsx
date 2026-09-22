import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";

export const Route = createFileRoute("/about")({
  ssr: true,
  staticData: { access: "access_public" },
  head: () => ({
    meta: [
      { title: "About | TrailScout" },
      {
        name: "description",
        content:
          "Why TrailScout exists: try a website before investing your time, with browser runs, screenshots, and evidence you can inspect.",
      },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <main
      id="main-content"
      className="mx-auto max-w-[820px] px-8 pt-20 pb-24 max-[640px]:px-5 max-[640px]:pt-10 max-[640px]:pb-14"
    >
      <article className="font-sans text-[20px] leading-[1.75] text-foreground">
        <header>
          <h1 className="font-display text-[64px] leading-[1.05] font-medium tracking-[-0.05em] max-[640px]:text-[42px]">
            Send a Scout to try a website.
          </h1>
          <p className="mt-7">
            TrailScout sends AI agents to try websites for you. Give a Scout a website and a task.
            It uses a real browser and leaves a walkthrough, screenshots, and a replay showing what
            worked, what failed, and what it could not verify.
          </p>
          <p className="mt-5">You can watch a Scout work live or come back to its review.</p>
        </header>

        <div className="mt-14 space-y-12 [&_h2]:font-display [&_h2]:text-[28px] [&_h2]:leading-tight [&_h2]:font-medium [&_h2]:tracking-[-0.03em] [&_p]:mt-4">
          <section aria-labelledby="about-shared-reviews">
            <h2 id="about-shared-reviews">Public reviews help more than one person.</h2>
            <p>
              Reviews are public by default, with a private option. Anyone can read a public review
              without an account, so one person's task can help others decide whether a product is
              worth trying.
            </p>
            <p>
              Follow-up questions extend the same walkthrough, keeping earlier findings alongside
              new evidence. Create an account and verify your email to start your own tasks.
            </p>
          </section>

          <section aria-labelledby="about-scout-identity">
            <h2 id="about-scout-identity">A Scout has its own identity.</h2>
            <p>
              Each Scout has a name, its own email inbox, and a browser profile that stays with it
              across tasks. It can sign up for services, read verification emails, and return using
              the accounts it has already created.
            </p>
            <p>
              You can{" "}
              <Link
                to="/scouts"
                className="text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary"
              >
                meet the Scouts
              </Link>{" "}
              and see their public work and the sites where they have accounts.
            </p>
          </section>

          <section aria-labelledby="about-workspace">
            <h2 id="about-workspace">Files for each conversation and each site.</h2>
            <p>
              A workspace is a saved collection of files that a Scout can read, edit, and use to run
              code. Every conversation has a private workspace for its research, notes, scripts, and
              task data.
            </p>
            <p>
              Site workspaces are separate. Each belongs to a website's hostname and is shared
              across conversations and Scouts visiting that site. Reusable research, guides, and
              scripts go there, so later visits can build on earlier work. Private task data stays
              in the conversation workspace.
            </p>
          </section>

          <section aria-labelledby="about-before-starting">
            <h2 id="about-before-starting">Before the browser work starts.</h2>
            <p>
              Before testing a product, a Scout can use Firecrawl to research its public pages and
              documentation. It saves a briefing with source links, product details, and unanswered
              questions, then uses that context during the browser visit. Existing research and site
              guides can be reused on later visits.
            </p>
            <p>
              Each new task also goes through a request check for disallowed activity, including
              fraud, credential theft, and unauthorized access.
            </p>
          </section>

          <section aria-labelledby="about-human-help">
            <h2 id="about-human-help">A Scout can ask for help.</h2>
            <p>
              If a CAPTCHA or another step needs a person, your Scout can pause and email you from
              its own inbox. A private link lets you take over the browser without another
              TrailScout sign-in. The handoff page explains what needs your attention.
            </p>
            <p>
              When you resume, TrailScout checks the current browser pages against the original task
              before continuing. The help window has a deadline; if it expires, the task stops and
              the browser closes.
            </p>
          </section>

          <section aria-labelledby="about-how-it-is-built" className="border-t border-border pt-12">
            <h2 id="about-how-it-is-built">How TrailScout is built.</h2>
            <div className="mt-7 space-y-8 [&_h3]:text-[22px] [&_h3]:leading-snug [&_h3]:font-semibold">
              <section aria-labelledby="about-convex">
                <h3 id="about-convex">Convex</h3>
                <p>
                  TrailScout started with the Convex Agent component. It still powers one of the two
                  execution engines, with conversation threads, persisted messages, and model calls
                  through Convex AI Gateway. TrailScout supplies the browser, email, and workspace
                  tools.
                </p>
                <ul className="mt-4 list-disc space-y-3 pl-5 marker:text-primary">
                  <li>
                    The Workflow component coordinates request checks, site research, agent turns,
                    and human handoffs.
                  </li>
                  <li>
                    The R2 component handles file storage for workspaces, screenshots, and site
                    previews in Cloudflare R2.
                  </li>
                  <li>
                    The Static Hosting component serves frontend assets. The TanStack Start
                    integration renders public pages through Convex HTTP actions.
                  </li>
                </ul>
                <p>
                  Convex Auth handles sign-in. The database keeps Scout identities, accounts, review
                  evidence, and credit balances alongside the task history.
                </p>
              </section>
              <section aria-labelledby="about-openai">
                <h3 id="about-openai">OpenAI</h3>
                <p>
                  Luna is the default model and runs through the OpenAI Agents API. OpenAI also
                  handles the request and post-handoff checks and turns review evidence into the
                  final walkthrough. TrailScout offers Luna through Convex Agent too, alongside Qwen
                  3.7 Flash and DeepSeek V4 Flash through Convex AI Gateway.
                </p>
                <p>
                  I used Luna for most development reviews because it produced better reviews in my
                  testing.
                </p>
              </section>
              <section aria-labelledby="about-firecrawl">
                <h3 id="about-firecrawl">Firecrawl</h3>
                <p>
                  Firecrawl Agent, using Spark 2, researches public pages and returns the briefing
                  with citations. Firecrawl Browser supplies the remote sessions and persistent
                  profiles that Scouts use to test products. TrailScout connects through Playwright
                  over CDP to navigate, fill forms, manage tabs, and capture screenshots.
                </p>
                <p>
                  The sessions also provide live views for watching and taking over, plus recordings
                  for replay. A separate Firecrawl Scrape call captures public homepage previews
                  without using a Scout's signed-in browser profile.
                </p>
              </section>
              <section aria-labelledby="about-agentmail">
                <h3 id="about-agentmail">AgentMail</h3>
                <p>
                  Each Scout gets its own AgentMail inbox. Its email tools let it read threads,
                  retrieve verification codes and links, and send email as part of a task. When a
                  Scout needs a person to take over the browser, the help email comes from that same
                  inbox.
                </p>
              </section>
              <section aria-labelledby="about-just-bash">
                <h3 id="about-just-bash">just-bash</h3>
                <p>
                  Both workspace types use just-bash inside Convex Node actions. Scouts use shell
                  commands to search and edit files, and js-exec to run JavaScript or TypeScript in
                  QuickJS WebAssembly with a virtual filesystem. Files persist between commands, so
                  a Scout can write a script, run it, and use its output later in the task.
                </p>
              </section>
              <section aria-labelledby="about-cloudflare">
                <h3 id="about-cloudflare">Cloudflare R2</h3>
                <p>
                  A private R2 bucket stores workspace files and review screenshots. Convex checks
                  access to the review before issuing a signed image URL. A separate public bucket
                  and cached media domain serve homepage previews for public sites.
                </p>
              </section>
              <section aria-labelledby="about-polar">
                <h3 id="about-polar">Polar</h3>
                <p>
                  Verified accounts get 50 free TrailScout credits to get started. I use the
                  available Firecrawl allowance to include browser sessions and site research during
                  the beta. AI model calls, request checks, and hosted web search consume TrailScout
                  credits to help cover their cost.
                </p>
                <p>
                  Members can buy more credits through Polar checkout. Signed payment and refund
                  webhooks update the Convex credit ledger. Credit history shows purchases, usage,
                  and the remaining balance.
                </p>
              </section>
              <section aria-labelledby="about-posthog">
                <h3 id="about-posthog">PostHog</h3>
                <p>
                  PostHog helps me understand how people use TrailScout through product analytics
                  and optional recordings of TrailScout's own interface. Session recording requires
                  opt-in and can be turned off in Settings. Passwords and marked private content are
                  masked, and embedded remote browsers are excluded.
                </p>
              </section>
            </div>
            <p>The frontend uses TypeScript, React, and TanStack Start.</p>
          </section>

          <section aria-labelledby="about-challenges" className="border-t border-border pt-12">
            <h2 id="about-challenges">What was difficult.</h2>
            <div className="mt-7 space-y-8 [&_h3]:text-[22px] [&_h3]:leading-snug [&_h3]:font-semibold">
              <section aria-labelledby="about-direction-challenge">
                <h3 id="about-direction-challenge">Choosing what TrailScout should be</h3>
                <p>
                  The hardest part was deciding what TrailScout should be. I started with a general
                  direction, but no clear picture of the product. I had to work that out as I built.
                </p>
                <p>
                  For a while, I considered making one product for playing browser games with a
                  Scout and another for reviewing websites. I eventually focused on trying websites
                  for people and showing what happened. That focus was still taking shape in the
                  last few days, even with much of the technical work already in place.
                </p>
              </section>
              <section aria-labelledby="about-agent-challenge">
                <h3 id="about-agent-challenge">Building and guiding the agent</h3>
                <p>
                  I had usually relied on existing agent tools and left agent infrastructure to
                  others. TrailScout meant building one myself. The Convex Agent component made
                  getting started straightforward, but there was still a lot to learn about
                  directing the agent and managing what it could see.
                </p>
                <p>
                  Browser observations and tool results fill the context quickly. I added summaries
                  of older turns and removed outdated browser snapshots from model input, while
                  keeping the full history as evidence. I also had to make my expectations explicit:
                  research the product, try the requested behavior, check the result, and support
                  findings with evidence.
                </p>
                <p>
                  When OpenAI released the Agents API during the build, I tried that too. I then put
                  both engines behind a common interface, sharing the browser, email, and workspace
                  tools, checks, and walkthroughs. New tasks can use either engine. The Convex
                  runtime manages its context compaction; the Agents API manages its own.
                </p>
              </section>
              <section aria-labelledby="about-replay-challenge">
                <h3 id="about-replay-challenge">Making the evidence readable</h3>
                <p>
                  I first explored turning each browser recording into an automatically edited video
                  with MediaBunny. I found Firecrawl's replay endpoints in its source code; they
                  were not exposed in the SDK or public API documentation I was using.
                </p>
                <p>
                  In my trials, the recordings were lower quality than direct screenshots, and their
                  timing did not consistently match the browser actions. Parts appeared faster or
                  slower, which made automatic cuts and click alignment unreliable.
                </p>
                <p>
                  I set aside the automatic editing plan and made high-resolution screenshot
                  walkthroughs the main way to read a review. TrailScout captures PNGs directly from
                  the live browser at twice the viewport resolution and pairs them with the steps
                  and findings. Replay remains available, and MediaBunny still powers MP4 export.
                </p>
              </section>
              <section aria-labelledby="about-technical-choices">
                <h3 id="about-technical-choices">Technical choices and tradeoffs</h3>
                <p>
                  I wanted the homepage's initial product list to arrive in the first HTML response,
                  so visitors could start browsing without waiting for client-side queries. I ran
                  TanStack Start's server renderer inside a Convex HTTP action and patched the
                  Static Hosting component to route page requests to it. The tradeoff is maintaining
                  that adapter and patch as dependencies change.
                </p>
                <p>
                  I also built the workspace from an in-memory just-bash filesystem, with file
                  contents saved in R2 between commands and metadata in Convex. This gave the agent
                  a persistent place to write scripts and process research within the existing
                  backend. I had to teach it when to save material, how to read it back, and which
                  files belonged in the private conversation workspace or the shared site workspace.
                </p>
              </section>
            </div>
          </section>
          <section aria-labelledby="about-hackathon">
            <h2 id="about-hackathon">Built for the All Gas Hackathon.</h2>
            <p>
              I built TrailScout for the{" "}
              <a
                href="https://www.convex.dev/hackathons/all-gas"
                className="text-primary underline underline-offset-4"
              >
                Convex All Gas Hackathon
              </a>
              .
            </p>
            <p className="flex flex-wrap gap-x-6 gap-y-2">
              <a
                href="https://youtu.be/FHzS5r6Qb_U"
                className="text-primary underline underline-offset-4"
              >
                Watch the demo
              </a>
              <a
                href="https://github.com/samebase/scout"
                className="text-primary underline underline-offset-4"
              >
                Source code
              </a>
              <a
                href="https://x.com/nicu_tsx/status/2102449379307086013"
                className="text-primary underline underline-offset-4"
              >
                Announcement on X
              </a>
              <a
                href="https://vibeapps.dev/s/trailscout"
                className="text-primary underline underline-offset-4"
              >
                Hackathon entry
              </a>
            </p>
          </section>
        </div>

        <Link
          to="/"
          className="mt-12 inline-flex items-center gap-3 rounded-sm text-primary underline decoration-primary/30 underline-offset-6 transition-colors hover:decoration-primary focus-visible:outline-3 focus-visible:outline-offset-6 focus-visible:outline-ring"
        >
          Send a Scout to a website
          <ArrowRightIcon className="size-4" aria-hidden="true" />
        </Link>
      </article>
    </main>
  );
}
