import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { FileIcon, FolderIcon, LinkIcon, LoaderCircleIcon, PlayIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../convex/_generated/api";
import { bashResultSchema, WORKSPACE_ROOT, type WorkspaceEntry } from "../../convex/workspaceModel";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

type CommandRecord = { id: string; command: string } & (
  | { kind: "running" }
  | { kind: "completed"; result: ReturnType<typeof bashResultSchema.parse> }
  | { kind: "failed"; error: string }
);

export function ScoutWorkspace({
  threadId,
  disabled,
  selectedPath,
  onSelectPath,
  terminalOpen,
  onToggleTerminal,
}: {
  threadId: string;
  disabled: boolean;
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
}) {
  const workspace = useQuery(api.scout.workspaces.list, { threadId });
  const executeTool = useAction(api.scout.manual.executeTool);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<CommandRecord[]>([]);
  const running = useRef(false);
  const output = useRef<HTMLDivElement>(null);
  const selected = workspace?.entries.find((entry) => entry.path === selectedPath);
  const busy = history.some((record) => record.kind === "running");

  useEffect(() => {
    if (output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [history]);

  async function runCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!command.trim() || running.current || disabled || !workspace?.configured) return;
    running.current = true;
    const id = crypto.randomUUID();
    const submitted = command;
    setCommand("");
    setHistory((records) => [...records.slice(-49), { id, command: submitted, kind: "running" }]);
    let record: CommandRecord;
    try {
      const response = await executeTool({
        threadId,
        toolName: "bash",
        input: JSON.stringify({ command: submitted }),
        operationId: id,
      });
      if (response.outcome.kind === "error") {
        record = { id, command: submitted, kind: "failed", error: response.outcome.error };
      } else {
        record = {
          id,
          command: submitted,
          kind: "completed",
          result: bashResultSchema.parse(JSON.parse(response.outcome.output)),
        };
      }
    } catch (error) {
      record = {
        id,
        command: submitted,
        kind: "failed",
        error: error instanceof Error ? error.message : "Command could not be completed",
      };
    } finally {
      running.current = false;
    }
    setHistory((records) => records.map((item) => (item.id === id ? record : item)));
  }

  return (
    <section aria-label="Workspace" className="flex h-full min-h-0 min-w-0 flex-col">
      {workspace === undefined ? (
        <p className="text-muted-foreground p-4 text-sm">Loading workspace…</p>
      ) : !workspace.configured ? (
        <p role="status" className="border-b bg-muted/40 p-4 text-sm">
          Connect R2 storage to run commands and save files. Set the R2 bucket and credentials in
          this Convex deployment.
        </p>
      ) : null}
      <div className="grid min-h-40 flex-1 grid-cols-[minmax(7rem,30%)_minmax(0,1fr)] overflow-hidden">
        <nav aria-label="Workspace files" className="overflow-auto border-r p-2 text-xs">
          {workspace?.entries.some((entry) => entry.path !== WORKSPACE_ROOT) ? (
            <WorkspaceFileTree
              entries={workspace.entries}
              directory={WORKSPACE_ROOT}
              selectedPath={selectedPath}
              onSelect={onSelectPath}
            />
          ) : (
            <p className="text-muted-foreground p-2">No files yet.</p>
          )}
        </nav>
        <div className="flex min-h-0 min-w-0 flex-col">
          {selected?.kind === "file" ? (
            <WorkspaceFileViewer
              key={`${selected.path}:${selected.key}`}
              threadId={threadId}
              path={selected.path}
            />
          ) : selected?.kind === "symlink" ? (
            <p className="p-4 font-mono text-xs">
              {selected.path} → {selected.target}
            </p>
          ) : (
            <div className="text-muted-foreground grid flex-1 place-content-center gap-2 p-4 text-center text-sm">
              <p>Select a file to preview it.</p>
              <p className="text-xs">Ask Scout to create a file, or use the terminal below.</p>
            </div>
          )}
        </div>
      </div>
      <details open={terminalOpen} className="shrink-0 border-t">
        <summary
          className="cursor-pointer px-3 py-2 text-xs font-medium"
          onClick={(event) => {
            event.preventDefault();
            onToggleTerminal();
          }}
        >
          Terminal{" "}
          <span className="text-muted-foreground ml-2 font-mono font-normal">
            {workspace?.cwd ?? WORKSPACE_ROOT}
          </span>
        </summary>
        <div
          ref={output}
          role="log"
          aria-label="Terminal output"
          className="h-36 overflow-auto px-3 pb-2 font-mono text-xs"
        >
          {history.map((record) => (
            <div key={record.id} className="mb-3">
              <pre className="whitespace-pre-wrap break-words text-muted-foreground">
                $ {record.command}
              </pre>
              {record.kind === "running" ? (
                <p className="mt-1">Running…</p>
              ) : record.kind === "failed" ? (
                <pre role="alert" className="whitespace-pre-wrap break-words text-destructive">
                  {record.error}
                </pre>
              ) : (
                <>
                  {record.result.stdout ? (
                    <pre className="whitespace-pre-wrap break-words">{record.result.stdout}</pre>
                  ) : null}
                  {record.result.stderr ? (
                    <pre className="whitespace-pre-wrap break-words text-destructive">
                      {record.result.stderr}
                    </pre>
                  ) : null}
                  <p
                    className={
                      record.result.exitCode === 0 ? "text-muted-foreground" : "text-destructive"
                    }
                  >
                    Exit {record.result.exitCode}
                  </p>
                </>
              )}
            </div>
          ))}
        </div>
        <form
          onSubmit={(event) => void runCommand(event)}
          className="flex items-end gap-2 border-t p-2"
        >
          <Textarea
            aria-label="Bash command"
            placeholder={"printf 'Hello\\n' > hello.txt"}
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            disabled={disabled || busy || !workspace?.configured}
            rows={2}
            className="max-h-32 min-h-16 resize-y font-mono text-xs"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Button
            type="submit"
            size="icon-sm"
            aria-label="Run command"
            disabled={disabled || busy || !workspace?.configured || !command.trim()}
          >
            {busy ? <LoaderCircleIcon className="animate-spin" /> : <PlayIcon />}
          </Button>
        </form>
      </details>
    </section>
  );
}

function WorkspaceFileTree({
  entries,
  directory,
  selectedPath,
  onSelect,
}: {
  entries: WorkspaceEntry[];
  directory: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const children = entries
    .filter((entry) => entry.path.slice(0, entry.path.lastIndexOf("/")) === directory)
    .sort(
      (left, right) =>
        Number(right.kind === "directory") - Number(left.kind === "directory") ||
        (left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
    );
  return (
    <ul className="space-y-0.5">
      {children.map((entry) => (
        <li key={entry.path}>
          {entry.kind === "directory" ? (
            <details open>
              <summary className="cursor-pointer whitespace-nowrap rounded px-1 py-1.5 hover:bg-muted">
                <FolderIcon className="mr-1 inline size-3.5" />
                {entry.path.split("/").at(-1)}
              </summary>
              <div className="ml-3 border-l pl-2">
                <WorkspaceFileTree
                  entries={entries}
                  directory={entry.path}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                />
              </div>
            </details>
          ) : (
            <button
              type="button"
              aria-pressed={selectedPath === entry.path}
              onClick={() => onSelect(entry.path)}
              title={entry.path}
              className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-ring ${selectedPath === entry.path ? "bg-muted font-medium" : "hover:bg-muted/60"}`}
            >
              {entry.kind === "symlink" ? (
                <LinkIcon className="size-3.5 shrink-0" />
              ) : (
                <FileIcon className="size-3.5 shrink-0" />
              )}
              <span className="truncate">{entry.path.split("/").at(-1)}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function WorkspaceFileViewer({ threadId, path }: { threadId: string; path: string }) {
  const readFile = useAction(api.scout.workspaceTools.readFile);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; file: FunctionReturnType<typeof api.scout.workspaceTools.readFile> }
    | { kind: "failed"; error: string }
  >({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    void readFile({ threadId, path }).then(
      (file) => {
        if (!cancelled) setState({ kind: "ready", file });
      },
      (error: unknown) => {
        if (!cancelled)
          setState({
            kind: "failed",
            error: error instanceof Error ? error.message : "File could not be loaded",
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt, path, readFile, threadId]);
  return (
    <>
      <div className="flex min-h-9 items-center justify-between gap-2 border-b px-3 text-xs">
        <span className="truncate font-mono" title={path}>
          {path.slice(WORKSPACE_ROOT.length + 1)}
        </span>
        {state.kind === "ready" ? (
          <a
            href={state.file.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 underline underline-offset-4"
          >
            Download
          </a>
        ) : null}
      </div>
      {state.kind === "loading" ? (
        <p className="p-4 text-sm text-muted-foreground">Loading file…</p>
      ) : state.kind === "failed" ? (
        <div className="space-y-2 p-4">
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setState({ kind: "loading" });
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </Button>
        </div>
      ) : state.file.text === null ? (
        <p className="p-4 text-sm text-muted-foreground">
          This file has no text preview. Download it to open it.
        </p>
      ) : (
        <pre
          aria-label="File contents"
          className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed"
        >
          {state.file.text}
        </pre>
      )}
    </>
  );
}
