import { Link } from "@tanstack/react-router";
import Markdown from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { LegalLinks } from "./legal-links";

export function LegalDocument({ content }: { content: string }) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8 sm:py-12">
      <LegalLinks />
      <article
        className="mt-8 text-base leading-7 [overflow-wrap:anywhere]
          [&_h1]:mb-8 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:tracking-tight sm:[&_h1]:text-4xl
          [&_h2]:mt-12 [&_h2]:mb-4 [&_h2]:scroll-mt-24 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:leading-7
          [&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-2
          [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-4 [&_a:focus-visible]:outline-ring
          [&_blockquote]:my-6 [&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:bg-muted [&_blockquote]:px-5 [&_blockquote]:py-1 [&_blockquote]:text-sm
          [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm
          [&_th]:bg-muted [&_th]:font-semibold [&_th]:px-4 [&_th]:py-3 [&_th]:align-top
          [&_td]:border-t [&_td]:px-4 [&_td]:py-3 [&_td]:align-top"
      >
        <Markdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeSlug, { prefix: "legal-" }]]}
          components={{
            table: ({ children }) => (
              <div
                role="region"
                aria-label="Policy table"
                tabIndex={0}
                className="my-6 overflow-x-auto rounded-lg border focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              >
                <table className="w-full min-w-[46rem] border-collapse text-left text-sm leading-6">
                  {children}
                </table>
              </div>
            ),
            th: ({ children }) => <th scope="col">{children}</th>,
          }}
        >
          {content}
        </Markdown>
      </article>
      <footer className="mt-12 border-t pt-6">
        <Link
          to="/"
          className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          Back to Scout
        </Link>
      </footer>
    </main>
  );
}
