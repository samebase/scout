import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TerrainExplorer } from "#components/terrain-explorer";
import { terrainSettingsSchema } from "#lib/terrain-settings";

export const Route = createFileRoute("/terrain")({
  ssr: false,
  staticData: { access: "access_public" },
  validateSearch: terrainSettingsSchema.extend({
    view: z.enum(["terrain", "landing"]).default("terrain"),
  }),
  head: () => ({
    meta: [{ title: "Terrain explorer | TrailScout" }, { name: "robots", content: "noindex" }],
  }),
  component: TerrainPage,
});

function TerrainPage() {
  const { view, ...settings } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <TerrainExplorer
      settings={settings}
      view={view}
      onChange={(next) =>
        void navigate({
          search: { ...next, view: next.scene === "landscape" ? view : "terrain" },
          replace: true,
          resetScroll: false,
        })
      }
      onViewChange={(view) =>
        void navigate({ search: { ...settings, view }, replace: true, resetScroll: false })
      }
    />
  );
}
