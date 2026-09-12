import { GlobeIcon, PanelTopIcon, ScanEyeIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { replayPageUrlAt, type ReplayTimeline } from "#lib/browserReplayTimeline";

export function BrowserReplayHeader({
  pages,
  currentTimeMs,
  activePageId,
  following,
  onSelectPage,
}: {
  pages: ReplayTimeline["pages"];
  currentTimeMs: number;
  activePageId: string | null;
  following: boolean;
  onSelectPage: (pageId: string | null) => void;
}) {
  const tabsRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const activePage = pages.find((page) => page.pageId === activePageId);
  const url = activePage ? replayPageUrlAt(activePage, currentTimeMs) : null;

  useEffect(() => {
    const tabs = tabsRef.current;
    const activeTab = activeTabRef.current;
    if (!tabs || !activeTab) return;
    if (activeTab.offsetLeft < tabs.scrollLeft) {
      tabs.scrollLeft = activeTab.offsetLeft;
    } else if (activeTab.offsetLeft + activeTab.offsetWidth > tabs.scrollLeft + tabs.clientWidth) {
      tabs.scrollLeft = activeTab.offsetLeft + activeTab.offsetWidth - tabs.clientWidth;
    }
  }, [activePageId]);

  return (
    <div className="shrink-0 border-b bg-muted/70">
      <div
        ref={tabsRef}
        role="group"
        aria-label="Recorded tabs"
        className="relative flex min-w-0 items-end gap-1 overflow-x-auto px-2 pt-2"
      >
        {pages.map((page, index) => {
          const selected = page.pageId === activePageId;
          const tabUrl = replayPageUrlAt(page, currentTimeMs);
          const label = replayTabLabel(tabUrl ?? page.pageUrl, index);
          return (
            <button
              key={page.pageId}
              ref={selected ? activeTabRef : undefined}
              type="button"
              aria-pressed={selected}
              title={label}
              onClick={() => onSelectPage(page.pageId)}
              className={`flex h-10 min-w-28 max-w-52 shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 text-xs transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
                selected
                  ? "border-border/70 bg-background text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-background/50 hover:text-foreground"
              }`}
            >
              <PanelTopIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex min-w-0 items-center gap-2 bg-background px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-border/60 bg-muted/60 px-3 focus-within:ring-2 focus-within:ring-ring/40">
          <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            readOnly
            aria-label="Recorded URL"
            title={url ?? "URL not recorded"}
            value={url ?? ""}
            placeholder="URL not recorded"
            spellCheck={false}
            className="h-8 w-full min-w-0 select-text bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button
          type="button"
          onClick={() => onSelectPage(null)}
          aria-label="Follow activity"
          aria-pressed={following}
          title="Follow activity"
          className={`flex size-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
            following
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <ScanEyeIcon className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function replayTabLabel(url: string | null, index: number) {
  if (!url) return `Tab ${index + 1}`;
  const parsed = new URL(url);
  return parsed.hostname
    ? `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`
    : parsed.href;
}
