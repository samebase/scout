// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { measureTerrainBounds } from "./terrain-viewport";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

test("visible terrain bounds exclude the header, scrolling clip, and decorative tail", () => {
  const pane = document.createElement("div");
  const canvas = document.createElement("canvas");
  pane.style.overflowX = "hidden";
  pane.style.overflowY = "hidden";
  pane.append(canvas);
  document.body.append(pane);
  vi.spyOn(pane, "getBoundingClientRect").mockReturnValue(new DOMRect(288, 121, 682, 500));
  Object.defineProperties(pane, { clientWidth: { value: 682 }, clientHeight: { value: 500 } });
  const canvasBounds = vi
    .spyOn(canvas, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(288, 121, 682, 830));
  expect(measureTerrainBounds(canvas, 550)).toEqual({ left: 0, top: 0, right: 682, bottom: 500 });
  canvasBounds.mockReturnValue(new DOMRect(288, -79, 682, 830));
  expect(measureTerrainBounds(canvas, 550)).toEqual({ left: 0, top: 200, right: 682, bottom: 550 });
});
