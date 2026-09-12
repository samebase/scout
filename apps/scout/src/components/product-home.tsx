import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, FocusIcon, Gamepad2Icon } from "lucide-react";
import { ProductShell } from "../products/shell";
import { ActivityFeed } from "./activity-feed";

export function ProductHome() {
  return (
    <ProductShell product={null}>
      <main
        id="main-content"
        className="mx-auto max-w-[1120px] px-9 pt-10 pb-16 max-[640px]:px-5 max-[640px]:pt-5"
      >
        <h1 className="mb-7 text-[42px] leading-tight font-semibold tracking-[-1.5px] max-[640px]:text-[32px]">
          What are we doing today?
        </h1>
        <div className="mb-12 grid grid-cols-2 gap-4 max-[640px]:mb-8 max-[480px]:grid-cols-1">
          <Link
            to="/play"
            search={{}}
            className="flex min-h-20 items-center gap-4 rounded-2xl border border-play-line bg-play-sand px-6 text-lg font-medium transition-colors hover:border-play-blue"
          >
            <Gamepad2Icon size={24} aria-hidden="true" />
            Play a game
            <ArrowRightIcon size={18} className="ml-auto" aria-hidden="true" />
          </Link>
          <Link
            to="/review"
            search={{}}
            className="flex min-h-20 items-center gap-4 rounded-2xl border border-play-line bg-[#e6edeb] px-6 text-lg font-medium transition-colors hover:border-play-blue"
          >
            <FocusIcon size={24} aria-hidden="true" />
            Review a product
            <ArrowRightIcon size={18} className="ml-auto" aria-hidden="true" />
          </Link>
        </div>
        <ActivityFeed />
      </main>
    </ProductShell>
  );
}
