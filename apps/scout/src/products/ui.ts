import { cva } from "class-variance-authority";

export const productButtonVariants = cva(
  "inline-flex items-center justify-center border text-[13px] transition-[background,transform] duration-180 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
  {
    variants: {
      variant: {
        play: "min-h-[50px] gap-[18px] rounded-[9px] border-transparent bg-primary px-[22px] font-semibold text-white hover:-translate-y-px hover:bg-primary/90 disabled:hover:translate-y-0 disabled:hover:bg-primary",
        playSecondary:
          "min-h-[50px] gap-[9px] rounded-[9px] border-border bg-white px-[22px] font-semibold text-foreground hover:-translate-y-px hover:bg-secondary disabled:hover:translate-y-0 disabled:hover:bg-white",
      },
    },
  },
);
