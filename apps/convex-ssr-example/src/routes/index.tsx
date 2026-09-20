import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
export const Route = createFileRoute("/")({
  loader: () =>
    new ConvexHttpClient(import.meta.env["VITE_CONVEX_URL"]).query(api.listings.list, {}),
  component: Home,
});
function Home() {
  const [count, setCount] = useState(0);
  const initial = Route.useLoaderData();
  const live = useQuery(api.listings.list, {});
  const rows = live ?? initial;
  return (
    <main>
      <h1>TanStack Start on Convex</h1>
      <p>Rendered directly inside a Convex HTTP action.</p>
      <ul>
        {rows.map((row) => (
          <li key={row._id}>
            <strong>{row.hostname}</strong>: {row.title}
          </li>
        ))}
      </ul>
      <button onClick={() => setCount(count + 1)}>Clicks: {count}</button>
      <p>
        <Link to="/about">About this probe</Link>
      </p>
    </main>
  );
}
