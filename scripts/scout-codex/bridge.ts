import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  browserBridgeResponseSchema,
  manualToolResultSchema,
  mcpBridgeToolCallSchema,
  preparedScoutRunSchema,
  type BrowserBridgeRequest,
  type ManualToolResult,
  type McpBridgeToolCall,
  type PreparedScoutRun,
  type RunnerTurnOutcome,
} from "../../src/lib/scoutRunnerProtocol.ts";
import { z } from "zod";

const MAX_REQUEST_BYTES = 1_000_000;
const BROWSER_REQUEST_TIMEOUT_MS = 120_000;
const browserRegistrationSchema = z.object({ clientId: z.string().uuid() }).strict();

type PendingBrowserRequest = {
  request: BrowserBridgeRequest;
  delivered: boolean;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export type RunnerToolCallRecord = Pick<McpBridgeToolCall, "toolName" | "input"> & {
  result: ManualToolResult;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown bridge error";
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BYTES) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const value: unknown = JSON.parse(text || "{}");
  return value;
}

function secretsMatch(received: string | undefined, expected: string) {
  const prefix = "Bearer ";
  if (!received?.startsWith(prefix)) return false;
  const actual = Buffer.from(received.slice(prefix.length));
  const wanted = Buffer.from(expected);
  return actual.byteLength === wanted.byteLength && timingSafeEqual(actual, wanted);
}

function pause(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export class ScoutRunnerBridgeServer {
  readonly #siteUrl: URL;
  readonly #secret = randomBytes(32).toString("base64url");
  readonly #toolCalls: RunnerToolCallRecord[] = [];
  readonly #server = createServer((request, response) => {
    void this.#route(request, response).catch((error: unknown) => {
      if (!response.headersSent) json(response, 500, { error: errorMessage(error) });
      else response.end();
    });
  });
  #registeredClientId: string | null = null;
  #registrationWaiters: Array<() => void> = [];
  #pending: PendingBrowserRequest | null = null;
  #prepared: PreparedScoutRun | null = null;
  #finished = false;

  constructor(siteUrl: string) {
    this.#siteUrl = new URL(siteUrl);
    if (this.#siteUrl.protocol !== "http:" && this.#siteUrl.protocol !== "https:") {
      throw new Error("Scout site URL must use HTTP or HTTPS");
    }
  }

  async start() {
    await new Promise<void>((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(0, "127.0.0.1", () => {
        this.#server.off("error", reject);
        resolve();
      });
    });
    const address = this.#server.address();
    if (!address || typeof address === "string") throw new Error("Runner bridge did not bind");
    return this.#connectionDetails(address);
  }

  async waitForBrowser(timeoutMs = 120_000) {
    if (this.#registeredClientId) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#registrationWaiters = this.#registrationWaiters.filter(
          (candidate) => candidate !== registered,
        );
        reject(new Error("Timed out waiting for the authenticated Scout page"));
      }, timeoutMs);
      const registered = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.#registrationWaiters.push(registered);
    });
  }

  async prepare(scoutSlug: string, prompt: string) {
    const request = {
      kind: "prepare",
      requestId: randomUUID(),
      scoutSlug,
      prompt,
    } satisfies BrowserBridgeRequest;
    const prepared = preparedScoutRunSchema.parse(await this.#requestBrowser(request));
    this.#prepared = prepared;
    return prepared;
  }

  async finish(outcome: RunnerTurnOutcome) {
    if (!this.#prepared) throw new Error("Scout chat has not been prepared");
    if (this.#finished) throw new Error("Scout chat has already been finished");
    const request = {
      kind: "finish",
      requestId: randomUUID(),
      threadId: this.#prepared.threadId,
      promptMessageId: this.#prepared.promptMessageId,
      outcome,
    } satisfies BrowserBridgeRequest;
    await this.#requestBrowser(request);
    this.#finished = true;
  }

  toolCalls() {
    return [...this.#toolCalls];
  }

  async close() {
    if (this.#pending) {
      clearTimeout(this.#pending.timeout);
      this.#pending.reject(new Error("Runner bridge closed"));
      this.#pending = null;
    }
    this.#server.closeAllConnections();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  #connectionDetails(address: AddressInfo) {
    const runnerUrl = `http://127.0.0.1:${address.port}/`;
    const pairingUrl = new URL("/chats", this.#siteUrl);
    pairingUrl.searchParams.set("runner", runnerUrl);
    pairingUrl.hash = `scout-runner=${this.#secret}`;
    return { runnerUrl, pairingUrl: pairingUrl.toString(), secret: this.#secret };
  }

  #setCors(request: IncomingMessage, response: ServerResponse) {
    response.setHeader("access-control-allow-origin", this.#siteUrl.origin);
    response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    response.setHeader("access-control-allow-headers", "authorization, content-type");
    response.setHeader("access-control-allow-private-network", "true");
    response.setHeader("cache-control", "no-store");
    response.setHeader("vary", "Origin");
    return request.headers.origin === this.#siteUrl.origin;
  }

  async #route(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const browserRoute =
      url.pathname === "/api/register" ||
      url.pathname === "/api/next" ||
      url.pathname === "/api/respond";
    const originMatches = browserRoute ? this.#setCors(request, response) : true;
    if (request.method === "OPTIONS") {
      response.writeHead(originMatches ? 204 : 403);
      response.end();
      return;
    }
    if (!secretsMatch(request.headers.authorization, this.#secret)) {
      json(response, 401, { error: "Unauthorized" });
      return;
    }
    if (browserRoute && !originMatches) {
      json(response, 403, { error: "Unexpected browser origin" });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/register") {
      const registration = browserRegistrationSchema.parse(await readJson(request));
      if (this.#registeredClientId && this.#registeredClientId !== registration.clientId) {
        json(response, 409, { error: "Runner already paired" });
        return;
      }
      const firstRegistration = this.#registeredClientId === null;
      this.#registeredClientId = registration.clientId;
      if (firstRegistration) {
        for (const waiter of this.#registrationWaiters.splice(0)) waiter();
      }
      json(response, 200, { ok: true });
      return;
    }
    if (!this.#registeredClientId && browserRoute) {
      json(response, 409, { error: "Runner has not paired" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/next") {
      if (!this.#pending || this.#pending.delivered) await pause(400);
      if (!this.#pending || this.#pending.delivered) {
        response.writeHead(204);
        response.end();
        return;
      }
      this.#pending.delivered = true;
      json(response, 200, this.#pending.request);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/respond") {
      const parsed = browserBridgeResponseSchema.parse(await readJson(request));
      if (
        !this.#pending ||
        !this.#pending.delivered ||
        parsed.requestId !== this.#pending.request.requestId
      ) {
        json(response, 409, { error: "No matching browser request" });
        return;
      }
      const pending = this.#pending;
      this.#pending = null;
      clearTimeout(pending.timeout);
      if (parsed.kind === "success") pending.resolve(parsed.value);
      else pending.reject(new Error(parsed.error));
      json(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/tool-call") {
      if (request.headers.origin !== undefined) {
        json(response, 403, { error: "Tool calls are accepted only from the local MCP process" });
        return;
      }
      const parsed = mcpBridgeToolCallSchema.parse(await readJson(request));
      if (!this.#prepared || parsed.threadId !== this.#prepared.threadId) {
        json(response, 409, { error: "Tool call does not belong to the prepared Scout chat" });
        return;
      }
      if (this.#finished) {
        json(response, 409, { error: "The prepared Scout chat is already finished" });
        return;
      }
      if (!this.#prepared.tools.some((tool) => tool.name === parsed.toolName)) {
        json(response, 400, { error: `Tool ${parsed.toolName} is unavailable for this chat` });
        return;
      }
      const bridgeRequest = {
        kind: "callTool",
        requestId: randomUUID(),
        threadId: parsed.threadId,
        promptMessageId: this.#prepared.promptMessageId,
        toolName: parsed.toolName,
        input: parsed.input,
      } satisfies BrowserBridgeRequest;
      const result = manualToolResultSchema.parse(await this.#requestBrowser(bridgeRequest));
      this.#toolCalls.push({ toolName: parsed.toolName, input: parsed.input, result });
      json(response, 200, result);
      return;
    }
    json(response, 404, { error: "Not found" });
  }

  #requestBrowser(request: BrowserBridgeRequest) {
    if (!this.#registeredClientId) return Promise.reject(new Error("Runner has not paired"));
    if (this.#pending) return Promise.reject(new Error("Another Scout tool call is still active"));
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.#pending?.request.requestId === request.requestId) this.#pending = null;
        reject(new Error("The authenticated Scout page did not answer in time"));
      }, BROWSER_REQUEST_TIMEOUT_MS);
      this.#pending = { request, delivered: false, resolve, reject, timeout };
    });
  }
}
