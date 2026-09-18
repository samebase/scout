import { createFileRoute } from "@tanstack/react-router";
import { LegalDocument } from "../components/legal-document";
import privacyPolicy from "../content/privacy-policy.md?raw";

export const Route = createFileRoute("/privacy")({
  staticData: { access: "access_public" },
  head: () => ({
    meta: [{ title: "Privacy policy | Scout" }, { name: "robots", content: "noindex" }],
  }),
  component: () => <LegalDocument content={privacyPolicy} />,
});
