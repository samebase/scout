import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { DiscoveryTerrain } from "./discovery-terrain";

export function DiscoveryHero({
  paused,
  children,
  ...terrain
}: Omit<ComponentProps<typeof DiscoveryTerrain>, "framingRef"> & {
  children: ReactNode;
}) {
  const [composing, setComposing] = useState(false);
  const framingRef = useRef<HTMLElement>(null);
  return (
    <section
      ref={framingRef}
      aria-labelledby="discovery-heading"
      className="relative isolate @container/hero text-foreground"
    >
      <div className="discovery-terrain-backdrop">
        <DiscoveryTerrain {...terrain} paused={paused || composing} framingRef={framingRef} />
      </div>
      <div className="pointer-events-none relative mx-auto grid max-w-[1160px] grid-cols-[1fr_390px] items-end gap-8 px-8 py-8 @max-[900px]/hero:grid-cols-1 @max-[900px]/hero:gap-4 @max-[640px]/hero:px-4 @max-[640px]/hero:py-7">
        <h1
          id="discovery-heading"
          className="font-display text-[64px] leading-[1.02] font-medium tracking-[-0.05em] @max-[760px]/hero:text-[52px] @max-[640px]/hero:text-[40px]"
        >
          Let Scout
          <br />
          try it first.
        </h1>
        <p className="relative isolate max-w-[490px] text-[17px] leading-relaxed text-foreground/80 before:absolute before:-inset-4 before:-z-10 before:bg-background/90 before:blur-xl @max-[640px]/hero:text-base">
          Give Scout a website and something to try. Its AI agents use it in a real browser and show
          you what worked, what failed, and where they got stuck.
        </p>
      </div>
      <div className="pointer-events-none relative mx-auto max-w-[1160px] px-8 @max-[640px]/hero:px-4">
        <div
          className="pointer-events-auto mx-auto mt-5 max-w-[660px] pb-8"
          onFocusCapture={() => setComposing(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setComposing(false);
          }}
        >
          {children}
        </div>
      </div>
    </section>
  );
}
