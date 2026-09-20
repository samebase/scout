// @vitest-environment happy-dom

import { expect, test } from "vite-plus/test";
import { getRouter } from "./router";

test("each router owns a separate query cache", () => {
  expect(getRouter().options.context?.queryClient).not.toBe(
    getRouter().options.context?.queryClient,
  );
});

test("the generated routes expose the shared Lab interface and retire Chats", () => {
  const router = getRouter();
  const paths = Object.keys(router.routesByPath);
  expect(paths).toContain("/lab");
  expect(paths).not.toContain("/agents");
  expect(paths).not.toContain("/chats");
  expect(paths).not.toContain("/handoff/$handoffId");
  expect(paths).toContain("/handoff/$sessionId");
  expect(paths).not.toContain("/review");
  expect(paths).not.toContain("/tasks");
  expect(paths).toContain("/tasks/$thread");
  expect(paths).toContain("/play");
  expect(router.routesByPath["/lab"].options.staticData).toEqual({ access: "access_lab" });
  expect(router.routesByPath["/handoff/$sessionId"].options.staticData).toEqual({
    access: "access_public",
  });
});
