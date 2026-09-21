import { useRef, type ComponentProps, type ReactNode } from "react";
import { DiscoveryTerrain } from "./discovery-terrain";
import { SamebaseAttribution } from "./samebase-attribution";

export function DiscoveryHero({
  paused,
  children,
  ...terrain
}: Omit<ComponentProps<typeof DiscoveryTerrain>, "framingRef"> & {
  children: ReactNode;
}) {
  const framingRef = useRef<HTMLElement>(null);
  return (
    <section
      ref={framingRef}
      aria-labelledby="discovery-heading"
      className="relative isolate @container/hero text-foreground"
    >
      <div className="discovery-terrain-backdrop">
        <DiscoveryTerrain {...terrain} paused={paused} framingRef={framingRef} />
      </div>
      <div className="pointer-events-none relative mx-auto max-w-[1160px] px-8 pt-2 pb-8 @max-[640px]/hero:px-4 @max-[640px]/hero:pb-7">
        <div className="relative isolate max-w-[940px] before:absolute before:-inset-4 before:-z-10 before:bg-background/90 before:blur-xl">
          <div className="pointer-events-auto w-fit text-muted-foreground" data-terrain-obstacle>
            <SamebaseAttribution />
          </div>
          <h1
            id="discovery-heading"
            data-terrain-obstacle
            className="pointer-events-auto text-balance font-display text-[56px] leading-[1.08] font-medium tracking-[-0.045em] @max-[760px]/hero:text-[44px] @max-[640px]/hero:text-[34px]"
          >
            Check if a product does what you need.
          </h1>
        </div>
        <div className="relative isolate mt-5 max-w-[660px] before:absolute before:-inset-4 before:-z-10 before:bg-background/90 before:blur-xl">
          <ul
            data-terrain-obstacle
            className="pointer-events-auto list-disc space-y-2 pl-6 text-xl leading-relaxed text-foreground marker:text-primary @max-[640px]/hero:text-lg"
          >
            <li>Send an AI agent to try a website for you.</li>
            <li>See what happened in a walkthrough, screenshots, and a replay.</li>
            <li>Public reviews make product claims checkable.</li>
          </ul>
        </div>
      </div>
      <div className="pointer-events-none relative mx-auto max-w-[1160px] px-8 @max-[640px]/hero:px-4">
        <div data-terrain-obstacle className="pointer-events-auto mx-auto mt-5 max-w-[660px] pb-8">
          {children}
        </div>
      </div>
    </section>
  );
}
