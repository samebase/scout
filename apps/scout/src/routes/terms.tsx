import { createFileRoute } from "@tanstack/react-router";
import { LegalDocument } from "../components/legal-document";
import termsOfService from "../content/terms-of-service.md?raw";

export const Route = createFileRoute("/terms")({
  staticData: { access: "access_public" },
  head: () => ({
    meta: [{ title: "Terms and conditions | Scout" }, { name: "robots", content: "noindex" }],
  }),
  component: () => <LegalDocument content={termsOfService} />,
});
