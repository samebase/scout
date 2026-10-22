import type { AgentSessionEvent, AgentSessionItem } from "openai/resources/beta/agents/agents";
import { expect, it } from "vite-plus/test";
import { SessionOutput } from "./events";

const eventBase = {
  event_id: "event",
  session_id: "session",
  turn_id: "turn",
  item_id: "message",
  output_index: 0,
};

const message: AgentSessionItem = {
  id: "message",
  type: "message",
  role: "assistant",
  phase: "commentary",
  status: "in_progress",
  turn_id: "turn",
  content: [],
};

it("streams assistant text and reasoning summaries before saved history is available", () => {
  const output = new SessionOutput();
  output.apply({ ...eventBase, type: "agent.session.turn.item.added", item: message });
  output.apply({
    ...eventBase,
    type: "agent.session.turn.output_text.delta",
    content_index: 0,
    delta: "Opening ",
  });
  expect(output.drain()[0]).toMatchObject({ kind: "assistant", text: "Opening ", complete: false });
  output.apply({
    ...eventBase,
    type: "agent.session.turn.output_text.delta",
    content_index: 0,
    delta: "the page.",
  });
  output.apply({
    ...eventBase,
    item_id: "reason",
    type: "agent.session.turn.reasoning_summary_text.delta",
    summary_index: 0,
    delta: "Checking the rules",
  });
  expect(output.drain().map(({ kind, text }) => ({ kind, text }))).toEqual([
    { kind: "assistant", text: "Opening the page." },
    { kind: "reasoning", text: "Checking the rules" },
  ]);
  expect(output.drain()).toEqual([]);
});

it("uses complete part text to repair missing deltas and keeps multiple parts separate", () => {
  const output = new SessionOutput();
  output.apply({
    ...eventBase,
    type: "agent.session.turn.output_text.delta",
    content_index: 0,
    delta: "page.",
  });
  output.apply({
    ...eventBase,
    type: "agent.session.turn.output_text.done",
    content_index: 0,
    text: "I opened the page.",
  });
  output.apply({
    ...eventBase,
    type: "agent.session.turn.output_text.done",
    content_index: 1,
    text: "It loaded.",
  });
  output.apply({
    ...eventBase,
    item_id: "reason",
    type: "agent.session.turn.reasoning_summary_text.done",
    summary_index: 0,
    text: "Full summary",
  });
  expect(output.drain().map((item) => item.text)).toEqual([
    "I opened the page.\nIt loaded.",
    "Full summary",
  ]);
});

it("does not treat unknown reasoning status as a completed item", () => {
  const output = new SessionOutput();
  output.restore({ id: "reason", type: "reasoning", status: null, summary: [], turn_id: "turn" });
  output.apply({
    ...eventBase,
    item_id: "reason",
    type: "agent.session.turn.reasoning_summary_text.delta",
    summary_index: 0,
    delta: "Still working",
  });
  expect(output.drain()[0]).toMatchObject({ text: "Still working", complete: false });
});

it("keeps computer use calls pending while preserving immutable approval history", () => {
  const output = new SessionOutput();
  const call = {
    id: "computer",
    type: "computer_use_call",
    status: "in_progress",
    title: "Opening the page",
    output: null,
    turn_id: "turn",
  } satisfies AgentSessionItem;
  const approvalHistory = [
    {
      id: "approval",
      type: "computer_use_approval_request",
      request_id: "request",
      turn_id: "turn",
      request: {
        type: "browser_authentication",
        credential_origin: "https://example.test",
        fields: [],
        options: [],
        reason: "Sign in to continue",
      },
    },
    {
      id: "approval-result",
      type: "computer_use_approval_request_result",
      request_id: "request",
      turn_id: "turn",
      response: { type: "browser_authentication", action: "cancel" },
    },
  ] satisfies AgentSessionItem[];
  for (const item of [call, ...approvalHistory]) {
    output.apply({ ...eventBase, type: "agent.session.turn.item.added", item });
  }
  expect(
    output.drain().map(({ providerItemId, complete }) => ({ providerItemId, complete })),
  ).toEqual([
    { providerItemId: "computer", complete: false },
    { providerItemId: "approval", complete: true },
    { providerItemId: "approval-result", complete: true },
  ]);
  for (const item of approvalHistory) {
    output.apply({ ...eventBase, type: "agent.session.turn.item.added", item });
  }
  output.apply({
    ...eventBase,
    type: "agent.session.turn.item.done",
    item: { ...call, status: "completed" },
  });
  expect(output.drain()).toMatchObject([{ providerItemId: "computer", complete: true }]);
});

it("replaces streamed output with its final item and ignores older buffered events after recovery", () => {
  const output = new SessionOutput();
  const delta: AgentSessionEvent = {
    ...eventBase,
    type: "agent.session.turn.output_text.delta",
    content_index: 0,
    delta: "partial",
  };
  output.apply(delta);
  output.apply({
    ...eventBase,
    type: "agent.session.turn.item.done",
    item: {
      ...message,
      id: "message",
      role: "assistant",
      phase: "final_answer",
      status: "completed",
      content: [{ type: "output_text", text: "Complete answer" }],
    },
  });
  output.apply(delta);
  expect(output.drain()[0]).toMatchObject({ text: "Complete answer", complete: true });
  const recovered = new SessionOutput();
  recovered.restore({
    ...message,
    status: "completed",
    content: [{ type: "output_text", text: "Saved answer" }],
  });
  recovered.apply(delta);
  expect(recovered.drain()).toEqual([]);
});
