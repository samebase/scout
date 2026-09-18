// @vitest-environment happy-dom

import { expect, test } from "vite-plus/test";
import { getRouter } from "./router";

test("the generated routes expose the shared Agents interface and retire Chats", () => {
  const router = getRouter();
  const paths = Object.keys(router.routesByPath);
  expect(paths).toContain("/agents");
  expect(paths).not.toContain("/chats");
  expect(paths).not.toContain("/handoff/$handoffId");
  expect(paths).not.toContain("/review");
  expect(paths).not.toContain("/tasks");
  expect(paths).toContain("/tasks/$thread");
  expect(paths).toContain("/play");
  expect(router.routesByPath["/agents"].options.staticData).toEqual({ access: "access_lab" });
});
