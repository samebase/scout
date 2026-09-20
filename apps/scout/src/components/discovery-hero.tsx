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
          Let Scout try it first.
        </h1>
        <div className="relative isolate mt-5 max-w-[660px] before:absolute before:-inset-4 before:-z-10 before:bg-background/90 before:blur-xl">
          <p className="text-[22px] leading-relaxed text-foreground @max-[640px]/hero:text-lg">
            Find out whether a product does what you need without spending an afternoon trying it.
          </p>
          <ul className="mt-5 list-disc space-y-1.5 pl-5 text-[17px] leading-relaxed text-foreground marker:text-primary @max-[640px]/hero:text-base">
            <li>Send an AI agent to try a website for you.</li>
            <li>See what happened with screenshots and a video replay.</li>
            <li>Browse public reviews before starting your own.</li>
          </ul>
        </div>
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
