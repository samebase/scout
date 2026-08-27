import { useAuthActions } from "@convex-dev/auth/react";
import { createFileRoute } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { QRCodeSVG } from "qrcode.react";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ConvexClientProvider } from "../lib/convex";
import { AuthPanel } from "#components/auth-panel";
import { Button } from "#components/ui/button";
import { Checkbox } from "#components/ui/checkbox";
import { Input } from "#components/ui/input";

const TODO_LIMIT = 50;
const TODO_TEXT_LIMIT = 280;

type VisibleTodo = {
  _id: Id<"todos">;
  creatorName: string;
  text: string;
  done: boolean;
  viewerCanToggle: boolean;
};

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <ConvexClientProvider>
      <TodoPage />
    </ConvexClientProvider>
  );
}

function TodoPage() {
  const [shareUrl, setShareUrl] = useState("");
  const todoState = useQuery(api.todos.list, {});
  const todos = todoState?.todos ?? [];
  const viewerTodoCount = todoState?.viewerTodoCount ?? null;
  const todoLimitReached = viewerTodoCount !== null && viewerTodoCount >= TODO_LIMIT;

  useEffect(() => {
    // Read the browser URL after mount so prerendered HTML stays stable.
    setShareUrl(window.location.href);
  }, []);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-4">
      <div className="mx-auto aspect-square w-full max-w-sm">
        {shareUrl ? (
          <QRCodeSVG
            value={shareUrl}
            size={384}
            level="M"
            marginSize={4}
            title="Share this app"
            className="size-full"
          />
        ) : null}
      </div>

      <AuthLoading>
        <section className="flex flex-col gap-3">
          <h1 className="text-lg">Todo list</h1>
        </section>
      </AuthLoading>
      <Unauthenticated>
        <AuthPanel />
      </Unauthenticated>
      <Authenticated>
        <TodoWorkspace todoLimitReached={todoLimitReached} />
      </Authenticated>
      <TodoList todos={todos} />
    </main>
  );
}

function TodoWorkspace({ todoLimitReached }: { todoLimitReached: boolean }) {
  const { signOut } = useAuthActions();
  const [draft, setDraft] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [createError, setCreateError] = useState("");
  const text = draft.trim();

  const createTodo = useMutation(api.todos.create);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!text || isCreating || todoLimitReached) {
      return;
    }

    setCreateError("");
    setIsCreating(true);
    try {
      await createTodo({ text });
      setDraft("");
    } catch (error: unknown) {
      setCreateError(error instanceof Error ? error.message : "Could not add todo");
    } finally {
      setIsCreating(false);
    }
  };

  const onSignOut = () => {
    setIsSigningOut(true);
    void signOut().finally(() => setIsSigningOut(false));
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg">Todo list</h1>
        <Button type="button" variant="outline" disabled={isSigningOut} onClick={onSignOut}>
          {isSigningOut ? "Signing out" : "Sign out"}
        </Button>
      </div>

      <form className="flex gap-2" onSubmit={onSubmit}>
        <Input
          placeholder="New todo"
          value={draft}
          maxLength={TODO_TEXT_LIMIT}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" disabled={!text || isCreating || todoLimitReached}>
          {isCreating ? "Adding" : "Add"}
        </Button>
      </form>
      {todoLimitReached ? (
        <p className="text-muted-foreground text-sm">Todo limit reached</p>
      ) : null}
      {createError ? (
        <p className="text-destructive text-sm" role="alert">
          {createError}
        </p>
      ) : null}
    </>
  );
}

function TodoList({ todos }: { todos: VisibleTodo[] }) {
  const toggleTodo = useMutation(api.todos.toggle);

  return (
    <ul className="space-y-2">
      {todos.map((todo) => (
        <li key={todo._id}>
          <label
            htmlFor={`todo-${todo._id}`}
            className={
              todo.viewerCanToggle
                ? "flex cursor-pointer items-center gap-3 border p-2"
                : "flex items-center gap-3 border p-2"
            }
          >
            <Checkbox
              id={`todo-${todo._id}`}
              checked={todo.done}
              disabled={!todo.viewerCanToggle}
              onCheckedChange={() => {
                if (!todo.viewerCanToggle) {
                  return;
                }
                void toggleTodo({ id: todo._id });
              }}
            />

            <span className="flex min-w-0 flex-col">
              <span className={todo.done ? "text-muted-foreground line-through" : ""}>
                {todo.text}
              </span>
              <span className="text-muted-foreground text-xs">Created by {todo.creatorName}</span>
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}
