/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    runtime: {
      cancel: FunctionReference<
        "action",
        "internal",
        { sessionKey: string },
        null,
        Name
      >;
      create: FunctionReference<
        "action",
        "internal",
        {
          instructions: string;
          model: string;
          onEvent: string;
          runKey: string;
          sessionKey: string;
          toolsJson: string;
        },
        null,
        Name
      >;
      send: FunctionReference<
        "action",
        "internal",
        { message: string; runKey: string; sessionKey: string },
        null,
        Name
      >;
      submitToolResult: FunctionReference<
        "action",
        "internal",
        {
          callId: string;
          result:
            | { kind: "success"; output: string }
            | { error: string; kind: "error" };
          resume: boolean;
          runKey: string;
          sessionKey: string;
          turnId: string;
        },
        null,
        Name
      >;
    };
    state: {
      get: FunctionReference<
        "query",
        "internal",
        { sessionKey: string },
        {
          _creationTime: number;
          _id: string;
          generation: number;
          itemCursor: string | null;
          nextSequence: number;
          onEvent: string;
          previousTurnId: string | null;
          providerId: string | null;
          revision: number;
          runKey: string;
          sessionKey: string;
          stopped: boolean;
          syncError: string | null;
          syncJobId: string | null;
        } | null,
        Name
      >;
      prepare: FunctionReference<
        "mutation",
        "internal",
        {
          expectedGeneration: number;
          previousTurnId: string | null;
          runKey: string;
          sessionKey: string;
        },
        {
          _creationTime: number;
          _id: string;
          generation: number;
          itemCursor: string | null;
          nextSequence: number;
          onEvent: string;
          previousTurnId: string | null;
          providerId: string | null;
          revision: number;
          runKey: string;
          sessionKey: string;
          stopped: boolean;
          syncError: string | null;
          syncJobId: string | null;
        },
        Name
      >;
      read: FunctionReference<
        "query",
        "internal",
        { sessionId: string },
        {
          _creationTime: number;
          _id: string;
          generation: number;
          itemCursor: string | null;
          nextSequence: number;
          onEvent: string;
          previousTurnId: string | null;
          providerId: string | null;
          revision: number;
          runKey: string;
          sessionKey: string;
          stopped: boolean;
          syncError: string | null;
          syncJobId: string | null;
        },
        Name
      >;
      refresh: FunctionReference<
        "mutation",
        "internal",
        { sessionKey: string },
        null,
        Name
      >;
      register: FunctionReference<
        "mutation",
        "internal",
        { onEvent: string; runKey: string; sessionKey: string },
        string,
        Name
      >;
      stop: FunctionReference<
        "mutation",
        "internal",
        { sessionKey: string },
        {
          _creationTime: number;
          _id: string;
          generation: number;
          itemCursor: string | null;
          nextSequence: number;
          onEvent: string;
          previousTurnId: string | null;
          providerId: string | null;
          revision: number;
          runKey: string;
          sessionKey: string;
          stopped: boolean;
          syncError: string | null;
          syncJobId: string | null;
        } | null,
        Name
      >;
      submitted: FunctionReference<
        "query",
        "internal",
        { callId: string; sessionId: string },
        boolean,
        Name
      >;
    };
  };
