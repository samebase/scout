import { createElement, Suspense } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type AnyRouter,
} from "@tanstack/react-router";
import {
  attachRouterServerSsrUtils,
  type HandlerCallback,
} from "@tanstack/react-router/ssr/server";
import { QueryClient, QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { ConvexQueryClient, convexQuery } from "@convex-dev/react-query";
import { ConvexHttpClient } from "convex/browser";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { api } from "../../convex/_generated/api";

const start = vi.hoisted(() => ({
  createStartHandler: vi.fn<(callback: HandlerCallback<AnyRouter>) => void>(),
}));
vi.mock("@tanstack/react-start/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start/server")>()),
  createStartHandler: start.createStartHandler,
}));

afterEach(() => vi.restoreAllMocks());

test("the Convex renderer waits for official query Suspense and includes its hydration data", async () => {
  let resolveCount: (value: { count: number; hasMore: boolean }) => void = () => {
    throw new Error("Query has not started");
  };
  const query = vi.spyOn(ConvexHttpClient.prototype, "consistentQuery").mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveCount = resolve;
      }),
  );
  const convex = new ConvexQueryClient("https://fixture.convex.cloud");
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { queryFn: convex.queryFn(), queryKeyHashFn: convex.hashFn(), retry: false },
    },
  });
  convex.connect(queryClient);
  function Count() {
    const { data } = useSuspenseQuery(convexQuery(api.scout.sites.count, { scope: "public" }));
    return createElement("h1", null, `${data.count} public sites`);
  }
  const root = createRootRoute({
    staticData: { access: "access_public" },
    component: () =>
      createElement(
        "html",
        null,
        createElement(
          "body",
          null,
          createElement(Suspense, { fallback: "Pending fixture" }, createElement(Count)),
        ),
      ),
  });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        path: "/",
        getParentRoute: () => root,
        staticData: { access: "access_public" },
      }),
    ]),
    history: createMemoryHistory(),
    isServer: true,
    Wrap: ({ children }) => createElement(QueryClientProvider, { client: queryClient }, children),
  });
  setupRouterSsrQueryIntegration({ router, queryClient, wrapQueryClient: false });
  attachRouterServerSsrUtils({ router, manifest: undefined });
  await router.load();
  await router.serverSsr?.dehydrate();
  await import("@samebase/convex-tanstack-start/server");
  const callback = start.createStartHandler.mock.calls[0]?.[0];
  if (!callback) throw new Error("Renderer was not registered");
  const pending = Promise.resolve(
    callback({
      router,
      request: new Request("https://fixture.test/"),
      responseHeaders: new Headers({ "Content-Type": "text/html" }),
    }),
  );
  let complete = false;
  void pending.then(() => {
    complete = true;
  });
  await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
  expect(complete).toBe(false);
  resolveCount({ count: 42, hasMore: false });
  const result = await pending;
  const response = result instanceof Response ? result : result.response;
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain("<h1>42 public sites</h1>");
  expect(html).not.toContain("Pending fixture");
  expect(html).toContain("scout/sites:count");
  expect(html).toContain("convexQuery");
  queryClient.clear();
  await convex.convexClient.close();
});
