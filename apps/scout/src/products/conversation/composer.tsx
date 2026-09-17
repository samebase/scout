import { ArrowUpIcon, SquareIcon } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

export function ConversationComposer({
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
      className="rounded-xl border border-border bg-card p-3 shadow-sm focus-within:border-primary/60"
    >
      <label className="sr-only" htmlFor="conversation-message">
        Message Scout
      </label>
      <textarea
        id="conversation-message"
        className="block max-h-[200px] min-h-[72px] w-full resize-none rounded-xl bg-transparent px-3 py-2 text-base leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none! [field-sizing:content]"
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
        <div className="min-w-0 text-sm text-muted-foreground">{children}</div>
        <button
          type={onStop ? "button" : "submit"}
          aria-label={onStop ? "Stop Scout" : "Send message"}
          title={onStop ? "Stop Scout" : "Send message"}
          onClick={onStop ?? undefined}
          disabled={disabled || (!onStop && (!canSend || !value.trim()))}
          className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
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
