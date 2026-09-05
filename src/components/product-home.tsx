import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, ArrowUpRightIcon, FocusIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "#lib/utils";
import { ScoutPiece } from "../products/play/scout-piece";
import { ProductCard } from "../products/ui";

function ProductChoice({ product, children }: { product: "play" | "review"; children: ReactNode }) {
  const isPlay = product === "play";
  return (
    <ProductCard
      product={product}
      asChild
      className={cn(
        "border-[#e2e5df] transition-[border-color,transform] duration-180 hover:-translate-y-[3px] hover:border-[#abb7b1] motion-reduce:transition-none",
        isPlay && "rounded-[19px]",
      )}
    >
      <Link
        to={isPlay ? "/play" : "/review"}
        aria-label={isPlay ? "Explore Scout Play" : "Explore Scout Review"}
      >
        {children}
        <div className="px-[30px] pt-[26px] pb-7 max-[760px]:p-[23px]">
          <div className="flex flex-wrap items-center gap-[13px]">
            <h2
              className={cn(
                "text-[29px] leading-[1.2] max-[760px]:text-[27px]",
                isPlay
                  ? "font-play-display font-bold tracking-[-1px]"
                  : "font-review font-medium tracking-[-1.1px]",
              )}
            >
              {isPlay ? (
                <>
                  Scout Play<span className="text-play-blue">.</span>
                </>
              ) : (
                "Scout Review"
              )}
            </h2>
            {!isPlay && (
              <span className="rounded-[3px] border border-[#dfe5e1] px-1.5 py-[3px] text-[10px] text-[#737a77]">
                Preview
              </span>
            )}
          </div>
          <p className="mt-3 mb-[23px] text-sm leading-[1.6] text-[#737a77]">
            {isPlay
              ? "One more player for your browser game."
              : "A fresh look at your product, backed by a recording."}
          </p>
          <span
            className={cn(
              "flex items-center justify-between text-[13px] font-semibold",
              isPlay ? "text-play-blue" : "text-[#28534e]",
            )}
          >
            {isPlay ? "Explore Play" : "Explore Review"}{" "}
            <ArrowRightIcon size={18} aria-hidden="true" />
          </span>
        </div>
      </Link>
    </ProductCard>
  );
}

const homeTile =
  "grid h-36 w-[105px] place-items-center rounded-[14px] bg-[#fffdf1] shadow-[0_5px_0_#d4bf68] max-[760px]:h-[129px] max-[760px]:w-[90px]";

export function ProductHome() {
  return (
    <div className="min-h-dvh bg-[#fafbf9] font-play-body text-[#27312f] antialiased scheme-light [&_:is(a,button):focus-visible]:outline-3 [&_:is(a,button):focus-visible]:outline-offset-6 [&_:is(a,button):focus-visible]:outline-play-blue">
      <a
        className="fixed -top-20 left-4 z-100 bg-[#27312f] p-3 text-white focus:top-4"
        href="#main-content"
      >
        Skip to content
      </a>
      <header className="mx-auto flex h-[100px] max-w-[1200px] items-center justify-between px-10 max-[760px]:h-[85px] max-[760px]:px-6">
        <Link
          to="/"
          className="text-[30px] font-semibold tracking-[-1.5px]"
          aria-label="Scout products"
        >
          scout.
        </Link>
        <Link
          to="/chats"
          className="inline-flex items-center gap-1.5 text-[13px] text-[#707772] hover:text-[#27312f]"
        >
          Lab <ArrowUpRightIcon size={14} aria-hidden="true" />
        </Link>
      </header>
      <main
        id="main-content"
        className="mx-auto max-w-[1200px] px-10 pt-[42px] pb-[70px] max-[760px]:max-w-[540px] max-[760px]:px-6 max-[760px]:pt-[30px] max-[760px]:pb-[45px]"
      >
        <h1 className="mb-[38px] text-[clamp(30px,3.2vw,42px)] leading-[1.2] font-medium tracking-[-1.5px] max-[760px]:mb-7 max-[760px]:tracking-[-1px]">
          What are we doing today?
        </h1>
        <div className="grid grid-cols-2 gap-7 max-[760px]:grid-cols-1 max-[760px]:gap-6">
          <ProductChoice product="play">
            <div
              className="flex h-[250px] items-center justify-center gap-[26px] bg-play-sand max-[760px]:h-[220px] max-[760px]:gap-5"
              aria-hidden="true"
            >
              <div className={cn(homeTile, "-rotate-7")}>
                <ScoutPiece appearance="you" />
              </div>
              <span className="text-2xl text-[#998b4c]">+</span>
              <div className={cn(homeTile, "rotate-7")}>
                <ScoutPiece />
              </div>
            </div>
          </ProductChoice>
          <ProductChoice product="review">
            <div
              className="grid h-[250px] place-items-center bg-[#e6edeb] p-[35px] max-[760px]:h-[220px]"
              aria-hidden="true"
            >
              <div className="w-[265px] max-w-full rounded-[3px] border border-[#cbd6d2] bg-[#fcfdfc] px-[22px] py-[19px] shadow-[7px_7px_0_#dbe3df]">
                <div className="flex items-center gap-2 border-b border-[#e6eae8] pb-[14px] font-mono text-[8px] tracking-[0.7px] text-[#456760]">
                  <FocusIcon size={16} /> <span>REVIEW / SIGNUP FLOW</span>
                </div>
                <span className="mt-[14px] mb-1.5 block font-mono text-[8px] tracking-[0.8px] text-[#808e88]">
                  OBSERVATION
                </span>
                <strong className="text-sm font-medium tracking-[-0.3px]">
                  A clearer way forward.
                </strong>
                <div className="mt-2.5 flex h-[27px] items-center gap-[5px] border border-[#c68b69] bg-[#fbf0e8] p-[7px]">
                  <span className="h-[3px] w-[70%] bg-[#d9b79c]" />
                  <span className="ml-auto h-[3px] w-[12%] bg-[#d9b79c]" />
                </div>
                <div className="mt-2.5 h-[3px] w-[90%] bg-[#e7ebe8]" />
                <div className="mt-[5px] h-[3px] w-[65%] bg-[#e7ebe8]" />
              </div>
            </div>
          </ProductChoice>
        </div>
      </main>
    </div>
  );
}
