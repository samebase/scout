import { cn } from "#lib/utils";

const sizes = {
  normal: "h-[73px] w-[71px]",
  brand: "h-[30px] w-[29px] -rotate-7 rounded-[10px_10px_9px_9px] shadow-none",
  tile: "h-[73px] w-[71px] max-[360px]:h-[62px] max-[360px]:w-[60px]",
};

export function ScoutPiece({
  appearance = "scout",
  size = "normal",
  className,
}: {
  appearance?: "scout" | "you";
  size?: keyof typeof sizes;
  className?: string;
}) {
  const eyeClassName = cn(
    "rounded-lg",
    size === "brand" ? "h-1.5 w-[3px]" : "h-[14px] w-1.5",
    appearance === "scout" ? "bg-primary-foreground" : "bg-[#663b32]",
  );
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-block shrink-0",
        appearance === "scout"
          ? "rounded-[26px_26px_20px_20px] bg-primary shadow-[inset_-6px_-7px_0_#0002,0_7px_0_color-mix(in_oklch,var(--primary),black_25%)]"
          : "rounded-[50%_50%_22px_22px] bg-[#ec8f73] shadow-[inset_-6px_-7px_0_#bc635044,0_7px_0_#b65e48]",
        sizes[size],
        className,
      )}
    >
      <span
        className={cn(
          "absolute inset-x-0 flex justify-center",
          size === "brand" ? "top-[11px] gap-[5px]" : "top-[27px] gap-[14px]",
          size === "tile" && "max-[360px]:top-[23px]",
        )}
      >
        <i className={eyeClassName} />
        <i className={eyeClassName} />
      </span>
    </span>
  );
}
