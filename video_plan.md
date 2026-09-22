## Why TrailScout exists

If you're on Twitter, you probably see 10 new app releases every single day. And especially during this AI boom, when everyone can build something and release it, it's very hard to filter out what actually works, what doesn't, because it's pretty easy to create a compelling landing page or to have a pitch. It's much harder to actually provide value.

And manually reviewing everything is pretty time-consuming and risky, because you have to give your email, or you have to figure out to get another email, then you can get lots of spam. And then you have to figure out how to actually use that thing. Very often, what I do is I actually used to search YouTube to see the actual founders, how they use their products.

## Scouts, accounts, and agent implementations

And that's what Trail Scout does for you. It's basically a small agent that you can send out, and it will try things out for you.

We have, in the center, there's the concept of a scout, and a scout is basically the identity that an agent can take. It has its own email that's based on agent mail, and it also manages its accounts, right? It has its own password, or it remembers how if you signed in with GitHub or you signed in with whatever else.

Of course, there's a security concern. So for this, we use the da-da-da algorithm. I have to remember which one. So it's as safe as I could make it.

The agent itself initially was made using the Convex agent component, and then OpenAI released the Agents API, and I also use that one. And now you can kind of choose between the two because we have a common interface. You can kind of figure out.

## Demo: Samebase signup and app deployment

So while we speak, let's give it a task, and it will run in the background. We already have, like, more than 100 reviewed sites. Some of them have a single task. Let's review. Some of them have several. We'll probably ask our agent to create a Sainbase account and deploy an app, right? That's a pretty complex task because it should actually be two tasks, because signing up is pretty complex for an agent, and also it's complex because it has to connect to GitHub and to its Cloudflare account, and it has to use OAuth.

A side note is that the internet is full of captchas, so the agent can request some human help. So if it encounters a captcha or something that it cannot overcome, it will send an email to the sender, to whoever started the task, asking it for help. We'll maybe show an example of that later in the video.

## Public reviews and credits

The main differentiator between Trail Scout and other similar services is that there's a big push to making the reviews public, because otherwise another option would have been to create, for example, agents that are owned by a specific user, but then the cost would be pretty significant. But here we kind of crowdsource because we have, for now, have three agents. We could probably raise that up a bit more if there's need. So the agents are not really owned by any one of the users. Anyone can just ask them, and usually...

Also we give 50 credits, and that's around 50 cents. Hopefully that's not abused, but you can also buy more credits using Polar.

## Workspaces and site knowledge

Some of the interesting things that we can talk about is the fact that the agent has a workspace, so it can actually run Bash, and it can run actually TypeScript or JavaScript files. The main reason for this is that sometimes Firecrawl will send you very big HTML outputs, and initially, sometimes we would put them in context, and then they would either get trimmed, or they would affect compaction. So the current solution for a lot of tools that we have is that when the agent requests, you know, to see some output, that output will be written to its workspace, and it can then use some Bash tools to actually filter out and get what it needs, or, you know, just get the whole file.

And each task has its own workspace, but also there's a workspace more general per each site. So for example, if an agent finds some useful information about a site that would be useful for For, you know, later task, it would write some instructions there, some briefs about what the site is and, you know, some common tricks.

Initially, this idea came before the initial product also allowed you to actually play games online with this agent. And so the agent would use the workspace to kind of, when it figures out a better way to play a game, it will actually write those instructions. But it still seems to be useful for product reviews. So that's mostly it.

## Recordings and walkthroughs

Regarding the output, right? Initially, the idea was that we would get the video recording and then we would use media bunny to actually, you know, fast-forward some sections, because very often you have, like, seven-minute videos, but then, you know, five minutes of it is just waiting. The problem with that was, mainly the problem was that the video recording timeline wasn't exactly as the timeline recorded by the agent. So something happens, but the video is at some points stretched out and some points fast-forwarded. So it's hard to pinpoint, for example, when to show a click or when to fast-forward it, etc. But you can still see the full video.

And also for the videos, we have, you know, several tabs, because, for example, in the same base, it has to go through a few pages. So you have several tabs of that. So when you watch the video, there's checkboxes, and it will basically switch to one tab from another. Of course, due to the same issue of timeline sync, sometimes this switching is not exactly correct. So alas.

So because of that, we added a feature which is called Walkthrough, where you get, like, curated screenshots of much better quality, and you also get some text.

## Admin lab and safety checks

Of course, we have this chat, but there are more processes that go behind the curtain. So, for example, I can show you what an admin sees. An admin has access to a lab. So in the lab, it can also, besides the chat, it can also see other things. Because, for example, in order to combat the possibility that someone would, you know, try to review an illegal site or something, there's a check. So we send, like, a file crawl request to get the review of that site, and then a different agent, you know, one shots and tries to figure out if it's safe to actually do that review.

And the same check is also done after the human handoff, because if you send some human an email and ask for help, they can actually probably go to a different route. So before that gets back to the main chat, it also gets reviewed again. So yeah.

## TrailScout reviews itself and closing

I guess the final thing, and I'm doing this live, will be to actually review TrailScout using TrailScout. So we'll ask this agent to create an account. Of course, an agent can work on a single thing at once. So since we have three agents, it will ask another agent to actually create an account with TrailScout and, I don't know, check if Google can find something. I don't know.

So that's it. If you're a judge, make sure you use this, because you get a lot of reviews for all the sites.
