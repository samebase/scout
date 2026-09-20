import { createFileRoute, Link } from "@tanstack/react-router";
export const Route = createFileRoute("/about")({
  component: () => (
    <main>
      <h1>About the SSR probe</h1>
      <p>This route also renders on Convex.</p>
      <Link to="/">Back to reviews</Link>
    </main>
  ),
});
