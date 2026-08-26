import { fetchJson, requireEnv, requireRecord, requireString } from "./http";

const AGENTMAIL_BASE_URL = "https://api.agentmail.to/v0";

export type InboxMessageSummary = {
  messageId: string;
  from: string;
  subject: string;
  timestamp: string;
};

export type InboxMessage = InboxMessageSummary & {
  text: string;
  html: string;
};

function headers() {
  return {
    Authorization: `Bearer ${requireEnv("AGENTMAIL_API_KEY")}`,
  };
}

function optionalString(record: Record<string, unknown>, field: string) {
  const value = record[field];
  return typeof value === "string" ? value : "";
}

function parseSummary(value: unknown): InboxMessageSummary {
  const message = requireRecord(value, "AgentMail");
  return {
    messageId: requireString(message, "message_id", "AgentMail"),
    from: optionalString(message, "from"),
    subject: optionalString(message, "subject"),
    timestamp: optionalString(message, "timestamp"),
  };
}

export async function listInboxMessages(inboxId: string, after: string) {
  const query = new URLSearchParams({ limit: "10", after });
  const response = requireRecord(
    await fetchJson(
      "AgentMail",
      `${AGENTMAIL_BASE_URL}/inboxes/${encodeURIComponent(inboxId)}/messages?${query}`,
      { method: "GET", headers: headers() },
    ),
    "AgentMail",
  );
  const messages = response["messages"];
  if (!Array.isArray(messages)) {
    throw new Error("AgentMail response is missing messages");
  }
  return messages.map(parseSummary);
}

export async function getInboxMessage(inboxId: string, messageId: string): Promise<InboxMessage> {
  const response = requireRecord(
    await fetchJson(
      "AgentMail",
      `${AGENTMAIL_BASE_URL}/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`,
      { method: "GET", headers: headers() },
    ),
    "AgentMail",
  );

  return {
    ...parseSummary(response),
    text: optionalString(response, "extracted_text") || optionalString(response, "text"),
    html: optionalString(response, "extracted_html") || optionalString(response, "html"),
  };
}
