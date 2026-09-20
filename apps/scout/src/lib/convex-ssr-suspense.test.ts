import { createElement, Suspense, type ReactNode } from "react";
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
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionArgs, type FunctionReturnType } from "convex/server";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { api } from "../../convex/_generated/api";
import { TaskWalkthrough } from "../components/task-walkthrough";

const start = vi.hoisted(() => ({
  createStartHandler: vi.fn<(callback: HandlerCallback<AnyRouter>) => void>(),
}));
vi.mock("@tanstack/react-start/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start/server")>()),
  createStartHandler: start.createStartHandler,
}));

afterEach(() => vi.restoreAllMocks());

async function startRendering(content: ReactNode) {
  const convex = new ConvexQueryClient("https://fixture.convex.cloud");
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { queryFn: convex.queryFn(), queryKeyHashFn: convex.hashFn(), retry: false },
    },
  });
  convex.connect(queryClient);
  const root = createRootRoute({
    staticData: { access: "access_public" },
    component: () =>
      createElement(
        "html",
        null,
        createElement(
          "body",
          null,
          createElement(Suspense, { fallback: "Pending fixture" }, content),
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
    Wrap: ({ children }) =>
      createElement(
        ConvexProvider,
        { client: convex.convexClient },
        createElement(QueryClientProvider, { client: queryClient }, children),
      ),
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
  return {
    pending,
    close: async () => {
      queryClient.clear();
      await convex.convexClient.close();
    },
  };
}

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
  function Count() {
    const { data } = useSuspenseQuery(convexQuery(api.scout.sites.count, { scope: "public" }));
    return createElement("h1", null, `${data.count} public sites`);
  }
  const render = await startRendering(createElement(Count));
  try {
    let complete = false;
    void render.pending.then(() => {
      complete = true;
    });
    await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
    expect(complete).toBe(false);
    resolveCount({ count: 42, hasMore: false });
    const result = await render.pending;
    const response = result instanceof Response ? result : result.response;
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("<h1>42 public sites</h1>");
    expect(html).not.toContain("Pending fixture");
    expect(html).toContain("scout/sites:count");
    expect(html).toContain("convexQuery");
  } finally {
    await render.close();
  }
});

test("a delayed task walkthrough renders its saved findings and checks before hydration", async () => {
  type Result = FunctionReturnType<typeof api.tasks.walkthrough.get>;
  // @ts-expect-error The mocked transport uses a stable fixture ID instead of a database-generated session ID.
  const sessionId: FunctionArgs<typeof api.tasks.walkthrough.get>["sessionId"] = "session-ssr";
  const saved: NonNullable<Result> = {
    walkthrough: {
      summary: "The board supports playing and undoing a move.",
      checks: [
        {
          label: "Undo the move",
          result: "passed",
          explanation: "Undo restored the previous board.",
        },
      ],
      sections: [
        {
          heading: "Play a move",
          explanation: "The piece lands in the selected column.",
          // @ts-expect-error The mocked transport uses a stable screenshot ID whose image has been removed.
          captureIds: ["capture-ssr"],
        },
      ],
    },
    captures: [],
  };
  let resolveWalkthrough: (value: Result) => void = () => {
    throw new Error("Walkthrough query has not started");
  };
  const query = vi.spyOn(ConvexHttpClient.prototype, "consistentQuery").mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveWalkthrough = resolve;
      }),
  );
  const screenshot = vi
    .spyOn(ConvexReactClient.prototype, "action")
    .mockRejectedValue(new Error("Screenshot actions must stay in the browser"));
  const render = await startRendering(createElement(TaskWalkthrough, { sessionId }));
  try {
    let complete = false;
    void render.pending.then(() => {
      complete = true;
    });
    await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
    const call = query.mock.calls[0];
    if (!call) throw new Error("Walkthrough query has not started");
    expect(getFunctionName(call[0])).toBe("tasks/walkthrough:get");
    expect(call[1]).toEqual({ sessionId });
    expect(complete).toBe(false);
    resolveWalkthrough(saved);
    const result = await render.pending;
    const response = result instanceof Response ? result : result.response;
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toMatch(/<p[^>]*>The board supports playing and undoing a move\.<\/p>/);
    expect(html).toMatch(/<h2[^>]*>Play a move<\/h2>/);
    expect(html).toContain('aria-label="Review checks"');
    expect(html).toContain("</span>Undo the move</p>");
    expect(html).toContain("No screenshot for this step.");
    expect(html).not.toContain('aria-label="Task walkthrough" aria-busy="true"');
    expect(html).not.toContain("Pending fixture");
    expect(html).toContain("tasks/walkthrough:get");
    expect(html).toContain("convexQuery");
    expect(screenshot).not.toHaveBeenCalled();
  } finally {
    await render.close();
  }
});
