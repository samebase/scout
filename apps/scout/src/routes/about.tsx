import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";

export const Route = createFileRoute("/about")({
  ssr: true,
  staticData: { access: "access_public" },
  head: () => ({
    meta: [
      { title: "About | Scout" },
      {
        name: "description",
        content:
          "Why Scout exists: try a website before investing your time, with browser runs, screenshots, and evidence you can inspect.",
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
            The internet is a confusing place.
          </h1>
          <p className="mt-7">
            Every website has a pitch. Finding out whether it does what you need usually means
            signing up, learning your way around, and trying it yourself.
          </p>
          <p className="mt-5">
            Scout is a project about doing that exploration for you, and leaving enough evidence for
            you to make up your own mind.
          </p>
        </header>

        <div className="mt-14 space-y-12 [&_h2]:font-display [&_h2]:text-[28px] [&_h2]:leading-tight [&_h2]:font-medium [&_h2]:tracking-[-0.03em] [&_p]:mt-4">
          <section aria-labelledby="about-send-scout">
            <h2 id="about-send-scout">Send Scout in first.</h2>
            <p>
              Give Scout a website and a question. It opens a real browser and tries to answer by
              using the product: following links, filling forms, and testing the path you asked
              about.
            </p>
            <blockquote className="my-6 border-l-2 border-primary/40 py-1 pl-6">
              “Can I make a screenshot and export it without paying?”
            </blockquote>
            <p>
              You can watch the visit as it happens, or come back to see how far Scout got and what
              it found along the way.
            </p>
          </section>

          <section aria-labelledby="about-evidence">
            <h2 id="about-evidence">Show the work.</h2>
            <p>
              An AI answer is only useful if you can check it. Scout keeps a record of the visit,
              with screenshots, a browser replay, and findings tied to the steps it took.
            </p>
            <p>
              You can see what passed, what failed, and what it couldn’t finish. A blocked sign-up
              or an interrupted task stays visible in the result.
            </p>
          </section>

          <section aria-labelledby="about-shared-reviews">
            <h2 id="about-shared-reviews">Useful beyond one visit.</h2>
            <p>
              Public explorations make the results reusable. Browse what other people asked Scout to
              try, open a review, and inspect the evidence before sending it on another task. You
              can also keep a task private.
            </p>
            <p>
              Scout is still an experiment. A run shows what happened on a particular visit. Sites
              change, and an agent can get stuck or miss something. The point is to help you decide
              what to try, with a clearer view of what you’re getting into.
            </p>
          </section>
        </div>

        <Link
          to="/"
          className="mt-12 inline-flex items-center gap-3 rounded-sm text-primary underline decoration-primary/30 underline-offset-6 transition-colors hover:decoration-primary focus-visible:outline-3 focus-visible:outline-offset-6 focus-visible:outline-ring"
        >
          Send Scout to a website
          <ArrowRightIcon className="size-4" aria-hidden="true" />
        </Link>
      </article>
      <p className="mt-16 text-sm text-muted-foreground">
        Scarf icon by{" "}
        <a
          href="https://www.flaticon.com/free-icon/scarf_12736059"
          className="underline underline-offset-4"
        >
          andinur on Flaticon
        </a>
        .
      </p>
    </main>
  );
}
