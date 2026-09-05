import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { cn } from "#lib/utils";
import { productButtonVariants } from "../ui";
import { PlayShell } from "./shell";
import { ScoutPiece } from "./scout-piece";

const playerTile =
  "flex h-[172px] w-[135px] shrink-0 flex-col items-center justify-center gap-6 rounded-2xl bg-[#fffdf1] shadow-[0_5px_0_#d4bf68] max-[1100px]:h-[155px] max-[1100px]:w-28 max-[760px]:h-[151px] max-[760px]:w-[113px] max-[360px]:h-[137px] max-[360px]:w-[94px] max-[360px]:gap-5";

const steps = [
  { title: "Open a game", description: "Start a room in a browser game." },
  { title: "Invite Scout", description: "Share the room link and any rules." },
  { title: "Play together", description: "Take your turns. Stop Scout whenever you need." },
];

export function PlayLanding() {
  return (
    <PlayShell>
      <main id="main-content">
        <div className="mx-auto grid min-h-[max(450px,calc(100dvh-300px))] max-w-[1328px] grid-cols-[1.1fr_1fr] items-center gap-[75px] px-16 pt-10 pb-16 max-[1100px]:gap-[35px] max-[1100px]:px-9 max-[760px]:flex max-[760px]:min-h-0 max-[760px]:max-w-[500px] max-[760px]:flex-col max-[760px]:items-stretch max-[760px]:gap-[45px] max-[760px]:px-[25px] max-[760px]:pb-[45px]">
          <div>
            <h1 className="text-[clamp(52px,6.2vw,84px)] leading-[1.04] font-bold tracking-[-4px] max-[1100px]:tracking-[-2.8px] max-[760px]:text-[clamp(45px,10vw,64px)] max-[760px]:tracking-[-2.6px]">
              Add a player
              <br />
              to your <span className="text-play-blue">game.</span>
            </h1>
            <p className="mt-[25px] max-w-[425px] text-[15px] text-play-muted max-[760px]:mt-5 max-[760px]:max-w-[320px] max-[760px]:text-sm">
              An AI player for your browser games. It's still learning, so expect a few questionable
              moves.
            </p>
            <Link
              to="/play/session"
              className={cn(
                productButtonVariants({ variant: "play" }),
                "mt-[30px] max-[760px]:mt-[25px]",
              )}
            >
              Invite Scout <ArrowRightIcon size={19} aria-hidden="true" />
            </Link>
          </div>
          <div
            className="flex h-[340px] min-w-0 items-center justify-center gap-[18px] rounded-[20px] bg-play-sand p-[25px] max-[1100px]:h-[310px] max-[1100px]:gap-[14px] max-[1100px]:p-[18px] max-[760px]:h-[245px] max-[760px]:gap-4 max-[360px]:h-[222px] max-[360px]:gap-[13px] max-[360px]:p-[14px]"
            role="img"
            aria-label="Two game pieces, you and Scout"
          >
            <div className={cn(playerTile, "-rotate-6")}>
              <ScoutPiece appearance="you" size="tile" />
              <span className="text-xs font-semibold">You</span>
            </div>
            <span className="text-[25px] text-[#938349]" aria-hidden="true">
              +
            </span>
            <div className={cn(playerTile, "rotate-6")}>
              <ScoutPiece size="tile" />
              <span className="text-xs font-semibold">Scout</span>
            </div>
          </div>
        </div>
        <section
          className="mx-auto max-w-[1328px] px-16 pb-11 max-[1100px]:px-9 max-[760px]:max-w-[500px] max-[760px]:px-[25px]"
          aria-label="How to play"
        >
          <ol
            role="list"
            className="grid grid-cols-3 gap-10 border-t border-play-line pt-[30px] max-[1100px]:gap-6 max-[760px]:grid-cols-1 max-[760px]:gap-[26px]"
          >
            {steps.map((step, index) => (
              <li key={step.title} className="flex items-start gap-[14px]">
                <span
                  className="grid size-[29px] shrink-0 place-items-center rounded-full border border-play-line text-xs text-play-muted"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <div>
                  <h2 className="mb-1 text-[17px] leading-[1.7] font-semibold">{step.title}</h2>
                  <p className="max-w-[260px] text-[13px] text-play-muted">{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </PlayShell>
  );
}
