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
          className="max-w-[940px] text-balance font-display text-[56px] leading-[1.08] font-medium tracking-[-0.045em] @max-[760px]/hero:text-[44px] @max-[640px]/hero:text-[34px]"
        >
          Check if a product does what you need.
        </h1>
        <div className="relative isolate mt-5 max-w-[660px] before:absolute before:-inset-4 before:-z-10 before:bg-background/90 before:blur-xl">
          <ul className="list-disc space-y-2 pl-6 text-xl leading-relaxed text-foreground marker:text-primary @max-[640px]/hero:text-lg">
            <li>Send an AI agent to try a website for you.</li>
            <li>Get a walkthrough, screenshots, and a video replay.</li>
            <li>Public reviews show whether products live up to their claims.</li>
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
