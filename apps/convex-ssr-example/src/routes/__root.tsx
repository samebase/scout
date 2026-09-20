import { createRootRoute, HeadContent, Scripts, Outlet } from "@tanstack/react-router";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useState } from "react";
export const Route = createRootRoute({ component: Root });
function Root() {
  const [client] = useState(() => new ConvexReactClient(import.meta.env["VITE_CONVEX_URL"]));
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body style={{ fontFamily: "system-ui", maxWidth: 800, margin: "60px auto", padding: 24 }}>
        <ConvexProvider client={client}>
          <Outlet />
        </ConvexProvider>
        <Scripts />
      </body>
    </html>
  );
}
