import { useState, type ComponentProps, type ReactNode } from "react";
import { DiscoveryTerrain } from "./discovery-terrain";

export function DiscoveryHero({
  paused,
  children,
  ...terrain
}: ComponentProps<typeof DiscoveryTerrain> & {
  children: ReactNode;
}) {
  const [composing, setComposing] = useState(false);
  return (
    <section
      aria-labelledby="discovery-heading"
      className="relative isolate @container/hero overflow-hidden bg-background text-foreground"
    >
      <div className="absolute inset-0 mask-[linear-gradient(to_bottom,black_45%,transparent_100%)]">
        <DiscoveryTerrain {...terrain} paused={paused || composing} />
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
