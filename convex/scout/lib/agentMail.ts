import { z } from "zod";

const AGENTMAIL_API_BASE_URL = "https://api.agentmail.to/v0";
const AGENTMAIL_OPERATION_TIMEOUT_MS = 30_000;
const AGENTMAIL_ATTEMPT_TIMEOUT_MS = 15_000;
const AGENTMAIL_REQUEST_ATTEMPTS = 2;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]{1,256}$/;

const agentMailInboxSchema = z
  .object({
    inbox_id: z.string().min(1),
    email: z.string().min(1),
  })
  .transform((inbox) => ({ inboxId: inbox.inbox_id, address: inbox.email }));

const agentMailSentMessageSchema = z
  .object({
    message_id: z.string().min(1),
    thread_id: z.string().min(1),
  })
  .transform((message) => ({ messageId: message.message_id, threadId: message.thread_id }));

type AgentMailFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type AgentMailDependencies = {
  fetch?: AgentMailFetch;
  timeoutSignal?: (milliseconds: number) => AbortSignal;
};

export type AgentMailInboxIdentity = {
  apiKey: string;
  inboxId: string;
};

export type AgentMailRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type AgentMailSendMessage = {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
};

export type AgentMailReplyToMessage = {
  messageId: string;
  text: string;
  idempotencyKey: string;
};

export type AgentMailSentMessage = z.output<typeof agentMailSentMessageSchema>;

function defaultFetch(input: string | URL | Request, init?: RequestInit) {
  return fetch(input, init);
}

class AgentMailRequestError extends Error {
  readonly retryable: boolean;
  readonly retryDelayMs: number;

  constructor(message: string, retryable: boolean, retryDelayMs = 0) {
    super(message);
    this.name = "AgentMailRequestError";
    this.retryable = retryable;
    this.retryDelayMs = retryDelayMs;
  }
}

function canonicalEmail(value: string) {
  return value.trim().toLowerCase();
}

function assertIdempotencyKey(value: string) {
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new Error("AgentMail idempotency key is invalid");
  }
}

async function responsePayload(response: Response, operation: string) {
  if (!response.ok) {
    const retryAfter = response.headers.get("Retry-After");
    const retryAfterMilliseconds = retryAfter === null ? 0 : Number(retryAfter) * 1_000;
    const retryDelayMs =
      Number.isFinite(retryAfterMilliseconds) && retryAfterMilliseconds >= 0
        ? retryAfterMilliseconds
        : 0;
    const retryable = response.status === 429 || response.status >= 500;
    throw new AgentMailRequestError(
      `AgentMail ${operation} failed (${response.status})`,
      retryable,
      retryable ? retryDelayMs : 0,
    );
  }
  try {
    const payload: unknown = await response.json();
    return payload;
  } catch {
    throw new AgentMailRequestError(
      `AgentMail ${operation} returned a non-JSON response (${response.status})`,
      true,
    );
  }
}

async function waitForRetry(milliseconds: number, signal: AbortSignal) {
  if (milliseconds <= 0) return;
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function agentMailFailureIsAmbiguous(error: unknown) {
  return !(error instanceof AgentMailRequestError) || error.retryable;
}

async function requestWithRetry<Result>(
  operationSignal: AbortSignal,
  timeoutSignal: (milliseconds: number) => AbortSignal,
  request: (signal: AbortSignal) => Promise<Result>,
) {
  for (let attempt = 1; attempt <= AGENTMAIL_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const signal = AbortSignal.any([
        operationSignal,
        timeoutSignal(AGENTMAIL_ATTEMPT_TIMEOUT_MS),
      ]);
      return await request(signal);
    } catch (error) {
      const finalAttempt = attempt === AGENTMAIL_REQUEST_ATTEMPTS;
      if (finalAttempt || operationSignal.aborted || !agentMailFailureIsAmbiguous(error)) {
        throw error;
      }
      await waitForRetry(
        error instanceof AgentMailRequestError ? error.retryDelayMs : 0,
        operationSignal,
      );
    }
  }
  throw new Error("AgentMail request retry loop ended unexpectedly");
}

export function requiredAgentMailApiKey(value: string | undefined) {
  const apiKey = value?.trim();
  if (!apiKey) throw new Error("AGENTMAIL_API_KEY is not configured");
  return apiKey;
}

export function createAgentMailInboxClient(
  identity: AgentMailInboxIdentity,
  dependencies: AgentMailDependencies = {},
) {
  const request = dependencies.fetch ?? defaultFetch;
  const timeoutSignal =
    dependencies.timeoutSignal ?? ((milliseconds: number) => AbortSignal.timeout(milliseconds));
  const inboxPath = encodeURIComponent(identity.inboxId);
  const authorization = `Bearer ${identity.apiKey}`;

  function operationSignal(options: AgentMailRequestOptions) {
    const timeout = timeoutSignal(options.timeoutMs ?? AGENTMAIL_OPERATION_TIMEOUT_MS);
    return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  }

  async function verifyAddress(address: string, options: AgentMailRequestOptions = {}) {
    await requestWithRetry(operationSignal(options), timeoutSignal, async (signal) => {
      const response = await request(`${AGENTMAIL_API_BASE_URL}/inboxes/${inboxPath}`, {
        headers: { Authorization: authorization },
        signal,
      });
      const payload = await responsePayload(response, "inbox lookup");
      const parsed = agentMailInboxSchema.safeParse(payload);
      if (!parsed.success) {
        throw new AgentMailRequestError(
          `AgentMail inbox lookup returned an invalid response (${response.status})`,
          true,
        );
      }
      if (
        parsed.data.inboxId !== identity.inboxId ||
        canonicalEmail(parsed.data.address) !== canonicalEmail(address)
      ) {
        throw new AgentMailRequestError(
          "Configured AgentMail inbox ID and address do not identify the same inbox",
          false,
        );
      }
    });
  }

  async function sendRequest(
    path: string,
    operation: string,
    body: Record<string, unknown>,
    idempotencyKey: string,
    options: AgentMailRequestOptions,
  ) {
    assertIdempotencyKey(idempotencyKey);
    return await requestWithRetry(operationSignal(options), timeoutSignal, async (signal) => {
      const response = await request(`${AGENTMAIL_API_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
        signal,
      });
      const payload = await responsePayload(response, operation);
      const parsed = agentMailSentMessageSchema.safeParse(payload);
      if (!parsed.success) {
        throw new AgentMailRequestError(
          `AgentMail ${operation} returned an invalid response (${response.status})`,
          true,
        );
      }
      return parsed.data;
    });
  }

  return {
    inboxId: identity.inboxId,
    verifyAddress,
    send: async (message: AgentMailSendMessage, options: AgentMailRequestOptions = {}) =>
      await sendRequest(
        `/inboxes/${inboxPath}/messages/send`,
        "send",
        { to: [message.to], subject: message.subject, text: message.text },
        message.idempotencyKey,
        options,
      ),
    reply: async (message: AgentMailReplyToMessage, options: AgentMailRequestOptions = {}) =>
      await sendRequest(
        `/inboxes/${inboxPath}/messages/${encodeURIComponent(message.messageId)}/reply`,
        "reply",
        { text: message.text, reply_all: false },
        message.idempotencyKey,
        options,
      ),
  };
}

export type AgentMailInboxClient = ReturnType<typeof createAgentMailInboxClient>;
