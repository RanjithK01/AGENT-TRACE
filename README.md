# AgentTrace

A small web console to **watch an AI agent work step by step**, pause it, and **redirect it mid-run** when it goes the wrong way.

I built this because most agent demos only show the final answer. When an agent goes off track you can't tell why. I wanted a screen where every thought, tool call and tool result shows up live, and where I can step in.

## What it does

- Streams the agent's steps live (thoughts, tool calls, tool results, final answer) using Server-Sent Events
- **Pause / Resume / Stop** a run
- **Redirect**: type a new instruction while the agent is running and it drops its old plan
- Timeline with a latency bar on each step, so slow steps are easy to spot
- Every run is saved in SQLite, so you can reopen it later
- **Compare two runs** side by side (steps, tool calls, total time)

## Tech

TypeScript, Node.js (plain `http`, no framework), React, SQLite (`node:sqlite`), Server-Sent Events, Claude API (tool use)

## Run it

Needs Node 22.13 or newer.

```bash
npm install
npm run dev        # builds the client and starts the server
# open http://localhost:3000
```

By default it uses a **mock agent**, so you can try everything without an API key.
To use the real model:

```bash
ANTHROPIC_API_KEY=your_key npm run dev
# optional: ANTHROPIC_MODEL=claude-sonnet-5-5
```

Try this: start the default run, press **Pause** after the first tool call, type
`Instead compute the population density of India` in the redirect box, then **Resume**.

Tests for the tools: `npm test`

## How it works

```
browser (React)  <--- SSE stream ---  server  ---> LLM (Claude or mock)
      |                                  |  \--> tools (lookup_fact, calculator)
      '--- POST pause/resume/redirect -->'  \--> SQLite (runs, steps)
```

- `server/agent.ts` is the agent loop: ask the model, run the tools it asks for, save each step, repeat.
- Before every step the loop checks if the run is paused, stopped, or has a pending redirect.
- A redirect is added to the conversation as a `[REDIRECT]` message so the model changes plan.

## Limits (things I know about)

- Pause and redirect only apply **between** steps, not in the middle of a model call.
- Only two small tools and a tiny fact table for now. New tools go in `server/tools.ts`.
- Control state for running agents lives in memory, so a server restart ends active runs (saved steps stay).
- I tested the mock agent end to end. The Claude path follows the Messages API tool-use format but needs your own key to try.

## Ideas for next

- WebSocket instead of SSE for two-way control
- Edit and re-run from any past step
- More tools (web search, code runner)
