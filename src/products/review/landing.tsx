import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, CircleAlertIcon, CornerDownRightIcon } from "lucide-react";
import { cn } from "#lib/utils";
import { ProductCard, productButtonVariants } from "../ui";
import { ReviewShell } from "./shell";

const exampleField = "h-7 rounded-[2px] border border-[#d6ddd8] bg-white";

export function ReviewLanding() {
  return (
    <ReviewShell>
      <main
        id="main-content"
        className="mx-auto max-w-[1280px] px-16 max-[1100px]:px-9 max-[760px]:max-w-[570px] max-[760px]:px-6"
      >
        <div className="grid min-h-[calc(100dvh-100px)] grid-cols-[1fr_1.04fr] items-center gap-20 pt-[54px] pb-[74px] max-[1100px]:gap-[42px] max-[760px]:min-h-0 max-[760px]:grid-cols-1 max-[760px]:gap-[38px] max-[760px]:pt-[45px] max-[760px]:pb-12">
          <div>
            <h1 className="text-[clamp(52px,5.6vw,74px)] leading-[1.04] font-medium tracking-[-2.8px] max-[1100px]:text-[58px] max-[760px]:text-[clamp(46px,9.5vw,60px)] max-[760px]:tracking-[-1.8px]">
              A review you
              <br />
              can watch.
            </h1>
            <p className="mt-[25px] max-w-[345px] text-base leading-[1.7] text-[#64776f] max-[760px]:mt-5 max-[760px]:text-sm">
              Send Scout a link and a task. Get findings with the recording behind them.
            </p>
            <Link
              to="/chats"
              className={cn(
                productButtonVariants({ variant: "review" }),
                "mt-[31px] max-[760px]:mt-[23px]",
              )}
            >
              Open the Lab <ArrowRightIcon size={18} aria-hidden="true" />
            </Link>
            <div className="mt-[41px] flex items-start gap-3 text-xs leading-[1.75] text-[#718178] max-[760px]:mt-[27px]">
              <CornerDownRightIcon size={17} className="mt-[3px] shrink-0" aria-hidden="true" />
              <span>
                Try a signup flow. Investigate a rough edge.
                <br />
                See what a fresh pair of eyes notices.
              </span>
            </div>
          </div>
          <ProductCard product="review" className="shadow-[9px_9px_0_#e4ebe6]">
            <div className="flex justify-between gap-2.5 border-b border-[#dce5df] px-[18px] py-[14px] font-review-mono text-[9px] tracking-[0.35px] text-[#6e8377] max-[760px]:p-[13px] max-[760px]:text-[8px]">
              <span>EXAMPLE / SIGNUP FLOW</span>
              <span className="max-[760px]:hidden">SCOUT REVIEW</span>
            </div>
            <ProductCard
              product="review"
              className="m-5 rounded-[3px] border-[#dbe2dd] max-[760px]:m-[14px]"
              role="img"
              aria-label="Illustrated signup screen: the error clears the form"
            >
              <div
                className="flex h-[30px] items-center gap-1 border-b border-[#e6ebe8] bg-[#f9faf9] px-2.5 [&>i]:size-1 [&>i]:rounded-full [&>i]:bg-[#c5cfca]"
                aria-hidden="true"
              >
                <i />
                <i />
                <i />
                <span className="m-auto pr-[19px] font-review-mono text-[8px] text-[#8b9690]">
                  example.app / signup
                </span>
              </div>
              <div
                className="grid min-h-[257px] place-items-center bg-[#f9faf9] p-[22px]"
                aria-hidden="true"
              >
                <div className="w-[210px] max-w-full">
                  <h3 className="mb-[17px] text-base font-medium tracking-[-0.3px]">
                    Create your account
                  </h3>
                  <span className="mt-2.5 mb-[5px] block text-[9px] text-[#89928d]">Email</span>
                  <div className={exampleField} />
                  <span className="mt-2.5 mb-[5px] block text-[9px] text-[#89928d]">Password</span>
                  <div className={exampleField} />
                  <div className="mt-[11px] flex items-center gap-1.5 border border-[#d5ae8f] bg-[#fcf0e5] p-[7px] text-[9px] text-[#956846]">
                    <CircleAlertIcon size={13} /> Something went wrong.
                  </div>
                  <div className="mt-[13px] grid h-[29px] place-items-center rounded-[2px] border border-[#d4dcd7] bg-[#e7ece9] text-[9px] text-[#86918a]">
                    Create account
                  </div>
                </div>
              </div>
            </ProductCard>
            <div className="flex items-center gap-[13px] px-5 pt-[14px] pb-[17px] max-[760px]:px-[14px] max-[760px]:pt-[13px]">
              <span className="font-review-mono text-[11px] text-[#a4714f]">02</span>
              <p className="text-base tracking-[-0.3px] max-[760px]:text-sm">
                The error clears the form.
              </p>
            </div>
          </ProductCard>
        </div>
      </main>
    </ReviewShell>
  );
}
