import type { AgentSessionEvent, AgentSessionItem } from "openai/resources/beta/agents/agents";
import { itemIsComplete, presentItem } from "./output";

/** Accumulates one stream; final snapshots replace partial text, including after reconnects. */
export class SessionOutput {
  private items = new Map<string, AgentSessionItem>();
  private changed = new Set<string>();

  restore(item: AgentSessionItem) {
    if (item.id !== null) this.items.set(item.id, item);
  }

  apply(event: AgentSessionEvent) {
    switch (event.type) {
      case "agent.session.turn.item.added":
      case "agent.session.turn.item.done": {
        const { item } = event;
        if (item.id === null) return;
        const previous = this.items.get(item.id);
        if (previous && itemIsComplete(previous)) return;
        this.items.set(item.id, item);
        this.changed.add(item.id);
        return;
      }
      case "agent.session.turn.output_text.delta":
      case "agent.session.turn.output_text.done": {
        if (event.turn_id === null) return;
        const item = this.items.get(event.item_id) ?? {
          id: event.item_id,
          type: "message",
          role: "assistant",
          phase: null,
          status: "in_progress",
          turn_id: event.turn_id,
          content: [],
        };
        if (item.type !== "message" || itemIsComplete(item)) return;
        const previous = item.content[event.content_index];
        item.content[event.content_index] = {
          type: "output_text",
          text:
            "text" in event
              ? event.text
              : (previous && previous.type !== "input_image" ? previous.text : "") + event.delta,
        };
        this.items.set(event.item_id, item);
        this.changed.add(event.item_id);
        return;
      }
      case "agent.session.turn.reasoning_summary_text.delta":
      case "agent.session.turn.reasoning_summary_text.done": {
        if (event.turn_id === null) return;
        const item = this.items.get(event.item_id) ?? {
          id: event.item_id,
          type: "reasoning",
          status: "in_progress",
          turn_id: event.turn_id,
          summary: [],
        };
        if (item.type !== "reasoning" || itemIsComplete(item)) return;
        item.summary[event.summary_index] = {
          type: "summary_text",
          text:
            "text" in event
              ? event.text
              : (item.summary[event.summary_index]?.text ?? "") + event.delta,
        };
        this.items.set(event.item_id, item);
        this.changed.add(event.item_id);
        return;
      }
      default:
        return;
    }
  }

  drain() {
    const result = [...this.changed].map((id) => presentItem(this.items.get(id)!));
    this.changed.clear();
    return result;
  }
}
