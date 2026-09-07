import { ArrowUpIcon, SquareIcon } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

export function PlayComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  canSend,
  onStop,
  placeholder,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  disabled: boolean;
  canSend: boolean;
  onStop: (() => void) | null;
  placeholder: string;
  children: ReactNode;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-[22px] border border-play-line bg-white p-3 shadow-[0_6px_24px_#25304406] focus-within:border-play-blue/60"
    >
      <label className="sr-only" htmlFor="play-message">
        Message Scout
      </label>
      <textarea
        id="play-message"
        className="block max-h-[200px] min-h-[72px] w-full resize-none rounded-xl bg-transparent px-3 py-2 text-base leading-relaxed text-play-ink placeholder:text-play-muted focus-visible:outline-none! [field-sizing:content]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (canSend && value.trim()) event.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder={placeholder}
        maxLength={16000}
        rows={2}
        disabled={disabled}
      />
      <div className="mt-2 flex min-h-11 items-center justify-between gap-3 pl-2">
        <div className="min-w-0 text-sm text-play-muted">{children}</div>
        <button
          type={onStop ? "button" : "submit"}
          aria-label={onStop ? "Stop Scout" : "Send message"}
          title={onStop ? "Stop Scout" : "Send message"}
          onClick={onStop ?? undefined}
          disabled={disabled || (!onStop && (!canSend || !value.trim()))}
          className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-play-blue text-white transition-colors hover:bg-[#2445bb]"
        >
          {onStop ? (
            <SquareIcon size={18} fill="currentColor" aria-hidden="true" />
          ) : (
            <ArrowUpIcon size={22} aria-hidden="true" />
          )}
        </button>
      </div>
    </form>
  );
}
