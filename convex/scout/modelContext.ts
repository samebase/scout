import { pruneMessages, type ModelMessage } from "ai";

function completedTurnReply(turn: ModelMessage[]) {
  if (turn.slice(1).some((message) => message.role === "system" || message.role === "user")) {
    return null;
  }

  const reply = turn.at(-1);
  if (reply?.role !== "assistant") return null;
  if (typeof reply.content === "string") return reply.content.trim().length > 0 ? reply : null;
  if (
    reply.content.some(
      (part) =>
        part.type === "tool-call" ||
        part.type === "tool-result" ||
        part.type === "tool-approval-request",
    ) ||
    !reply.content.some((part) => part.type === "text" && part.text.trim().length > 0)
  ) {
    return null;
  }

  const [withoutReasoning] = pruneMessages({ messages: [reply], reasoning: "all" });
  if (withoutReasoning.role !== "assistant" || typeof withoutReasoning.content === "string") {
    return withoutReasoning;
  }
  return {
    ...withoutReasoning,
    content: withoutReasoning.content.filter((part) => part.type !== "reasoning-file"),
  };
}

export function compactCompletedTurnContext(messages: ModelMessage[]) {
  const compacted: ModelMessage[] = [];

  for (let start = 0; start < messages.length;) {
    if (messages[start].role !== "user") {
      compacted.push(messages[start]);
      start += 1;
      continue;
    }

    let end = start + 1;
    while (end < messages.length && messages[end].role !== "user") end += 1;
    const turn = messages.slice(start, end);
    const reply = completedTurnReply(turn);
    compacted.push(...(reply ? [turn[0], reply] : turn));
    start = end;
  }

  return compacted;
}
