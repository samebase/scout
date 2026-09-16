import { httpRouter } from "convex/server";
import { z } from "zod";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { client } from "./client";

const webhook = z.object({
  id: z.string().min(1),
  type: z.enum([
    "agent.session.created",
    "agent.session.action_required",
    "agent.session.in_progress",
    "agent.session.idle",
    "agent.session.failed",
  ]),
  data: z.object({ id: z.string().min(1) }),
});

const http = httpRouter();
http.route({
  path: "/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = await request.text();
    const api = client();
    try {
      await api.webhooks.verifySignature(payload, request.headers);
    } catch {
      return new Response("Invalid webhook signature", { status: 400 });
    }
    let parsed: z.infer<typeof webhook>;
    try {
      parsed = webhook.parse(JSON.parse(payload));
    } catch {
      return new Response("Invalid session event", { status: 400 });
    }
    await ctx.runMutation(internal.state.receive, {
      eventId: parsed.id,
      providerId: parsed.data.id,
      type: parsed.type,
    });
    return new Response(null, { status: 204 });
  }),
});
export default http;
