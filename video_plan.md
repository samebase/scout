# Video plan

## Speaker notes

### Why TrailScout exists

If you're on X, you probably see ten new apps every day. Figuring out which ones actually work means giving out your email, signing up, and trying them yourself. Doing that for every product takes time, so I often search YouTube to watch founders use their own products.

That's why I built TrailScout. You give an agent a task, and it goes and tries the product for you.

### Scouts and accounts

A scout is the identity an agent uses across websites. Each has its own email inbox through AgentMail. It remembers its accounts and how to sign in, whether with a password or a social login. Stored passwords are encrypted using AES-256-GCM. These scouts are shared across users.

### Agent engines

You can choose between two agent engines: OpenAI's Agents API with Luna, or the Convex Agent component with Luna, Qwen, and DeepSeek. I used Luna for most reviews because, in my testing, it got stuck less often.

### Public reviews

Here I can choose whether the review is public or private. Reviews are public by default. Anyone can read those results, so one person's task can help others decide whether a product is worth trying.

### Demo: Samebase signup and app deployment

Now let's give it a task. I'm asking it to create a Samebase account, deploy an app, and check that it works. That involves signup, GitHub and Cloudflare connections, and OAuth authorization. Firecrawl provides the browser the scout uses.

### Human handoff

If a site needs human verification, the scout emails you a link to take over the browser. You help it through that step, then hand control back.

### Workspaces and site knowledge

The agent has a workspace where it saves files and runs code. Only admins can inspect it, so I'll switch to the admin view to show you.

It can save large tool outputs there and inspect them with Bash or TypeScript. It can also leave shared notes about a site, so later tasks can reuse what it learned.

### Recordings and walkthroughs

Here's the result of that run. The walkthrough pairs screenshots with an explanation of what the scout tried and what happened. You can also watch the browser recording to inspect the full attempt.

### TrailScout reviews itself and closing

And here's TrailScout reviewing itself. I asked it to create an account and ask another scout to find Convex's documentation. Try it with a product you're curious about.

## Detailed plan

Working draft for a three-minute video. The speaker notes above group the narration by section. In this detailed plan, plain paragraphs are spoken copy, italic notes are screen directions, and code blocks contain chat prompts. Original wording and earlier edits are preserved in HTML comments under the relevant sections.

_Recording assumption: Approval by default will be enabled before recording, so new accounts can start tasks without manual admin approval._

Recording sequence: Explain scout identity at the picker, then choose the engine and public/private setting before submitting the Samebase task. Record that task from start to finish and fast-forward waiting in the edit. Show the results of that same run, then close by showing a TrailScout self-review completed before recording.

Spoken draft: 372 words, plus one sentence describing the actual result. Chat prompts and screen directions are excluded. At 140-150 words per minute, the scripted copy takes roughly 149-159 seconds. Allow time for the result sentence, clicks, and fast-forwarded footage; verify the full three-minute cut with a timed read.

### Why TrailScout exists

_On screen: Show the homepage and review list._

If you're on X, you probably see ten new apps every day. Figuring out which ones actually work means giving out your email, signing up, and trying them yourself. Doing that for every product takes time, so I often search YouTube to watch founders use their own products.

That's why I built TrailScout. You give an agent a task, and it goes and tries the product for you.

<!--
Original wording: Why TrailScout exists

If you're on Twitter, you probably see 10 new app releases every single day. And especially during this AI boom, when everyone can build something and release it, it's very hard to filter out what actually works, what doesn't, because it's pretty easy to create a compelling landing page or to have a pitch. It's much harder to actually provide value.

And manually reviewing everything is pretty time-consuming and risky, because you have to give your email, or you have to figure out to get another email, then you can get lots of spam. And then you have to figure out how to actually use that thing. Very often, what I do is I actually used to search YouTube to see the actual founders, how they use their products.

Latest wording before this revision:

If you're on Twitter, you probably see 10 new app releases every single day. It's very hard to filter out what actually works.

And manually reviewing everything is time-consuming and risky, because you have to give your email. And then you have to figure out how to actually use the thing. Often, I search YouTube to see the actual founders, and how they use their own products.
-->

### Scouts and accounts

_On screen: Before starting the task, open the scout picker and choose a scout. Show its identity, inbox, and saved accounts._

A scout is the identity an agent uses across websites. Each has its own email inbox through AgentMail. It remembers its accounts and how to sign in, whether with a password or a social login. Stored passwords are encrypted using AES-256-GCM. These scouts are shared across users.

<!--
Original wording: Scouts, accounts, and agent implementations

And that's what Trail Scout does for you. It's basically a small agent that you can send out, and it will try things out for you.

We have, in the center, there's the concept of a scout, and a scout is basically the identity that an agent can take. It has its own email that's based on agent mail, and it also manages its accounts, right? It has its own password, or it remembers how if you signed in with GitHub or you signed in with whatever else.

Of course, there's a security concern. So for this, we use the da-da-da algorithm. I have to remember which one. So it's as safe as I could make it.

The agent itself initially was made using the Convex agent component, and then OpenAI released the Agents API, and I also use that one. And now you can kind of choose between the two because we have a common interface. You can kind of figure out.

Latest wording before this revision:

That’s why I built TrailScout. You give an agent a task, and it goes and tries the product for you.

At the center is the scout: an identity the agent uses across different websites. Each scout has its own email inbox through AgentMail. It remembers its accounts and how to sign in, whether with a password or a social login. Stored passwords are encrypted using AES-256-GCM.

You can choose between two agent engines: OpenAI’s Agents API with Luna, or the Convex Agent component with Luna, Qwen, and DeepSeek. I used Luna for most reviews because, in my testing, it got stuck less often.
-->

### Agent engines

_On screen: Still in the composer, show the engine and model choices before starting the task._

You can choose between two agent engines: OpenAI's Agents API with Luna, or the Convex Agent component with Luna, Qwen, and DeepSeek. I used Luna for most reviews because, in my testing, it got stuck less often.

<!-- The original engine paragraph is preserved in the Scouts and accounts section above. -->

### Public reviews

_On screen: Show the public/private setting in the composer and choose public for this task._

Here I can choose whether the review is public or private. Reviews are public by default. Anyone can read those results, so one person's task can help others decide whether a product is worth trying.

<!--
Original wording: Public reviews and credits

The main differentiator between Trail Scout and other similar services is that there's a big push to making the reviews public, because otherwise another option would have been to create, for example, agents that are owned by a specific user, but then the cost would be pretty significant. But here we kind of crowdsource because we have, for now, have three agents. We could probably raise that up a bit more if there's need. So the agents are not really owned by any one of the users. Anyone can just ask them, and usually...

Also we give 50 credits, and that's around 50 cents. Hopefully that's not abused, but you can also buy more credits using Polar.
-->

### Demo: Samebase signup and app deployment

_On screen: After choosing the scout, engine, and visibility, submit the prompt below. Record this run through to completion. In the edit, fast-forward waiting and show the signup, GitHub and Cloudflare connections, OAuth authorization, and deployment steps from this same run._

_Type in the chat box:_

```text
Create an account on samebase.com and deploy a small app. Check that it works.
```

Now let's give it a task. I'm asking it to create a Samebase account, deploy an app, and check that it works. That involves signup, GitHub and Cloudflare connections, and OAuth authorization. Firecrawl provides the browser the scout uses.

<!--
Original wording: Demo: Samebase signup and app deployment

So while we speak, let's give it a task, and it will run in the background. We already have, like, more than 100 reviewed sites. Some of them have a single task. Let's review. Some of them have several. We'll probably ask our agent to create a Sainbase account and deploy an app, right? That's a pretty complex task because it should actually be two tasks, because signing up is pretty complex for an agent, and also it's complex because it has to connect to GitHub and to its Cloudflare account, and it has to use OAuth.

A side note is that the internet is full of captchas, so the agent can request some human help. So if it encounters a captcha or something that it cannot overcome, it will send an email to the sender, to whoever started the task, asking it for help. We'll maybe show an example of that later in the video.
-->

### Human handoff

_On screen: Keep the Samebase run on screen while explaining what happens if a site needs human verification._

If a site needs human verification, the scout emails you a link to take over the browser. You help it through that step, then hand control back.

<!-- Earlier suggested wording: "For sites that need human verification, the scout can email you a link to take over the browser and help it continue." The original CAPTCHA paragraph is preserved in the Demo section above. -->

### Workspaces and site knowledge

_On screen: During the Samebase run, switch to the admin view to show that task's workspace and the shared site notes. Then return to the member view of the same running task._

The agent has a workspace where it saves files and runs code. Only admins can inspect it, so I'll switch to the admin view to show you.

It can save large tool outputs there and inspect them with Bash or TypeScript. It can also leave shared notes about a site, so later tasks can reuse what it learned.

<!--
Original wording: Workspaces and site knowledge

Some of the interesting things that we can talk about is the fact that the agent has a workspace, so it can actually run Bash, and it can run actually TypeScript or JavaScript files. The main reason for this is that sometimes Firecrawl will send you very big HTML outputs, and initially, sometimes we would put them in context, and then they would either get trimmed, or they would affect compaction. So the current solution for a lot of tools that we have is that when the agent requests, you know, to see some output, that output will be written to its workspace, and it can then use some Bash tools to actually filter out and get what it needs, or, you know, just get the whole file.

And each task has its own workspace, but also there's a workspace more general per each site. So for example, if an agent finds some useful information about a site that would be useful for For, you know, later task, it would write some instructions there, some briefs about what the site is and, you know, some common tricks.

Initially, this idea came before the initial product also allowed you to actually play games online with this agent. And so the agent would use the workspace to kind of, when it figures out a better way to play a game, it will actually write those instructions. But it still seems to be useful for product reviews. So that's mostly it.
-->

### Recordings and walkthroughs

_On screen: Wait for this Samebase run to finish, speeding up the waiting in the edit. Show its actual outcome and describe it in one sentence. Open the deployed app if one was created. Show this run's walkthrough, a finding with its screenshot, and its browser recording._

Here's the result of that run. The walkthrough pairs screenshots with an explanation of what the scout tried and what happened. You can also watch the browser recording to inspect the full attempt.

<!--
Original wording: Recordings and walkthroughs

Regarding the output, right? Initially, the idea was that we would get the video recording and then we would use media bunny to actually, you know, fast-forward some sections, because very often you have, like, seven-minute videos, but then, you know, five minutes of it is just waiting. The problem with that was, mainly the problem was that the video recording timeline wasn't exactly as the timeline recorded by the agent. So something happens, but the video is at some points stretched out and some points fast-forwarded. So it's hard to pinpoint, for example, when to show a click or when to fast-forward it, etc. But you can still see the full video.

And also for the videos, we have, you know, several tabs, because, for example, in the same base, it has to go through a few pages. So you have several tabs of that. So when you watch the video, there's checkboxes, and it will basically switch to one tab from another. Of course, due to the same issue of timeline sync, sometimes this switching is not exactly correct. So alas.

So because of that, we added a feature which is called Walkthrough, where you get, like, curated screenshots of much better quality, and you also get some text.
-->

### TrailScout reviews itself and closing

_Before recording: Open the completed TrailScout self-review and have its findings and nested task ready to show._

<!--
Self-review preparation is complete. Earlier planned prompt, kept for reference;
the actual run needed TrailScout's exact URL to identify the correct site:

```text
Review TrailScout itself.

Create an account on TrailScout, then use it to ask another scout to find Convex's documentation.
```
-->

_On screen: Open the completed TrailScout self-review. Show its findings and the task it requested from another scout._

And here's TrailScout reviewing itself. I asked it to create an account and ask another scout to find Convex's documentation. Try it with a product you're curious about.

<!-- Recording preparation: This plan assumes new accounts are approved automatically. Keep another scout available for the task submitted through the new account. -->

<!--
Previous suggested closing, with the self-review started during the video:

To finish, let's ask another scout to create an account on TrailScout and use it to ask a scout to find Convex's documentation. Try it with a product you're curious about.

Original wording: TrailScout reviews itself and closing

I guess the final thing, and I'm doing this live, will be to actually review TrailScout using TrailScout. So we'll ask this agent to create an account. Of course, an agent can work on a single thing at once. So since we have three agents, it will ask another agent to actually create an account with TrailScout and, I don't know, check if Google can find something. I don't know.

So that's it. If you're a judge, make sure you use this, because you get a lot of reviews for all the sites.
-->

<!--
Alternatives outside the current three-minute draft. These are options to swap in,
not extra narration to append. Original CAPTCHA and credits wording is preserved
in the Demo and Public reviews sections above.

Credits

Suggested wording: "Verified accounts get 50 free credits, and you can buy more
through Polar. Anyone can read public reviews."

Admin lab and safety checks

Suggested wording: "In the admin lab, I can inspect the checks behind a task.
One checks the request and supplied URLs before the task starts. Another checks
the browser's current pages against the original task after human help."

The initial request check does not browse or certify a site. Firecrawl research
is a separate step.

Original wording: Admin lab and safety checks

Of course, we have this chat, but there are more processes that go behind the curtain. So, for example, I can show you what an admin sees. An admin has access to a lab. So in the lab, it can also, besides the chat, it can also see other things. Because, for example, in order to combat the possibility that someone would, you know, try to review an illegal site or something, there's a check. So we send, like, a file crawl request to get the review of that site, and then a different agent, you know, one shots and tries to figure out if it's safe to actually do that review.

And the same check is also done after the human handoff, because if you send some human an email and ask for help, they can actually probably go to a different route. So before that gets back to the main chat, it also gets reviewed again. So yeah.
-->
