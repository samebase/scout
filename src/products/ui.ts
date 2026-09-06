import { cva } from "class-variance-authority";

export const productCardVariants = cva("min-w-0 overflow-hidden border bg-white", {
  variants: {
    product: {
      play: "rounded-xl border-play-line",
      review: "rounded-[5px] border-[#bccfc4]",
    },
  },
});

export const productButtonVariants = cva(
  "inline-flex items-center justify-center border text-[13px] transition-[background,transform] duration-180 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
  {
    variants: {
      variant: {
        play: "min-h-[50px] gap-[18px] rounded-[9px] border-transparent bg-play-blue px-[22px] font-semibold text-white hover:-translate-y-px hover:bg-[#2546bd] disabled:hover:translate-y-0 disabled:hover:bg-play-blue",
        playSecondary:
          "min-h-[50px] gap-[9px] rounded-[9px] border-play-line bg-white px-[22px] font-semibold text-play-ink hover:-translate-y-px hover:bg-play-cloud disabled:hover:translate-y-0 disabled:hover:bg-white",
        review:
          "min-h-[47px] gap-[23px] rounded-[3px] border-review-accent bg-review-accent px-[18px] font-normal text-white hover:bg-[#193f36]",
      },
    },
  },
);
