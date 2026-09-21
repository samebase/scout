// @vitest-environment happy-dom

import { expect, test, vi } from "vite-plus/test";
import { createDiscoveryField } from "./discovery-field";
import { terrainRenderProfiles } from "./terrain-quality";

const gpu = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock(import("typegpu"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual.default, init: gpu.init } };
});

test("an abandoned initialization cannot unconfigure the next mount's canvas", async () => {
  const root = {
    configureContext: vi.fn(),
    destroy: vi.fn(),
  };
  gpu.init.mockResolvedValue(root);
  const abort = new AbortController();
  const result = createDiscoveryField(
    document.createElement("canvas"),
    abort.signal,
    terrainRenderProfiles.high,
  );
  abort.abort();
  expect(await result).toBeNull();
  expect(root.configureContext).not.toHaveBeenCalled();
  expect(root.destroy).toHaveBeenCalledOnce();
});
