import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { useState, type ReactNode } from "react";

const convexUrl = import.meta.env["VITE_CONVEX_URL"];

export function ConvexClientProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [convexClient] = useState(() => {
    if (!convexUrl) {
      throw new Error(
        "VITE_CONVEX_URL is required. Run a supported Samebase dev or deploy command.",
      );
    }
    return new ConvexReactClient(convexUrl);
  });
  return <ConvexAuthProvider client={convexClient}>{children}</ConvexAuthProvider>;
}
