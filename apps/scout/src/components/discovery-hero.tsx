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
      <div className="pointer-events-none relative mx-auto max-w-[1160px] px-8 py-8 @max-[640px]/hero:px-4 @max-[640px]/hero:py-7">
        <h1
          id="discovery-heading"
          className="font-display text-[64px] leading-[1.02] font-medium tracking-[-0.05em] @max-[760px]/hero:text-[52px] @max-[640px]/hero:text-[40px]"
        >
          See what lies
          <br />
          beneath the pitch.
        </h1>
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
