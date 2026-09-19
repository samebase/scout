import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/scouts")({
  staticData: { access: "access_public" },
  head: () => ({ meta: [{ title: "Scouts | Scout" }] }),
  component: ScoutsLayout,
});

function ScoutsLayout() {
  return (
    <main className="route-page flex flex-col gap-8">
      <Outlet />
    </main>
  );
}
