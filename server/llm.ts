import { COUNTRIES, toolDefs } from "./tools";

// Messages use the same shape as the Anthropic Messages API.
export type Msg = { role: "user" | "assistant"; content: any };
export type ToolCall = { id: string; name: string; input: any };
export type LLMResult = { raw: any[]; text: string; toolCalls: ToolCall[] };
export interface LLM { next(history: Msg[]): Promise<LLMResult> }

const SYSTEM = "You are a careful research agent. Use the tools for facts and for any maths. " +
  "If the user sends a [REDIRECT] message, drop the old plan and follow the new instruction.";

// ---------- real model ----------
class ClaudeLLM implements LLM {
  async next(history: Msg[]): Promise<LLMResult> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
        max_tokens: 1000,
        system: SYSTEM,
        tools: toolDefs,
        messages: history,
      }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
    const data: any = await res.json();
    const text = data.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    const toolCalls = data.content
      .filter((b: any) => b.type === "tool_use")
      .map((b: any) => ({ id: b.id, name: b.name, input: b.input }));
    return { raw: data.content, text, toolCalls };
  }
}

// ---------- offline mock so the demo works without an API key ----------
// It "plans" from the latest instruction (the task, or a [REDIRECT] message)
// and calls tools one at a time, so pausing and redirecting can be seen live.
class MockLLM implements LLM {
  async next(history: Msg[]): Promise<LLMResult> {
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 600)); // fake thinking time

    // find the latest instruction (the task, or a [REDIRECT] text block)
    let instrIdx = 0;
    let instrBlock = 0;
    let instruction = "";
    history.forEach((m, i) => {
      const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
      blocks.forEach((b: any, j: number) => {
        if (m.role === "user" && b.type === "text") { instrIdx = i; instrBlock = j; instruction = b.text; }
      });
    });
    const redirected = instruction.startsWith("[REDIRECT]");
    const lower = instruction.toLowerCase();

    const countries = COUNTRIES.filter((c) => lower.includes(c));
    const facts: string[] = [];
    if (lower.includes("area") || lower.includes("size") || lower.includes("density")) facts.push("area");
    if (lower.includes("population") || lower.includes("density") || facts.length === 0) facts.push("population");
    const wantsMath = /ratio|compare|density|difference|how many times/.test(lower);

    // only look at things that happened AFTER the latest instruction
    const results: Record<string, number> = {};
    const calledKeys = new Set<string>();
    let calcDone = "";
    history.slice(instrIdx).forEach((m, mi) => {
      if (typeof m.content === "string") return;
      m.content.forEach((b: any, bj: number) => {
        if (mi === 0 && bj <= instrBlock) return; // skip old blocks in the same message
        if (b.type === "tool_use" && b.name === "lookup_fact") calledKeys.add(`${b.input.country}|${b.input.fact}`);
        if (b.type === "tool_result") {
          const hit = String(b.content).match(/^(\w+) (population|area): ([\d.]+)/);
          if (hit) results[`${hit[1]}|${hit[2]}`] = Number(hit[3]);
          if (String(b.content).includes(" = ")) calcDone = String(b.content);
        }
      });
    });

    const id = () => "toolu_mock_" + Math.random().toString(36).slice(2, 8);
    const call = (text: string, name: string, input: any): LLMResult => {
      const tc = { id: id(), name, input };
      return { text, toolCalls: [tc], raw: [{ type: "text", text }, { type: "tool_use", ...tc }] };
    };

    if (countries.length === 0) {
      const text = `I only have data for: ${COUNTRIES.join(", ")}. Tell me which of these to look at.`;
      return { text, toolCalls: [], raw: [{ type: "text", text }] };
    }

    // 1) look up whatever is still missing
    for (const c of countries) {
      for (const f of facts) {
        if (!calledKeys.has(`${c}|${f}`)) {
          const prefix = redirected && calledKeys.size === 0 ? "New instruction received, dropping my old plan. " : "";
          return call(`${prefix}I need the ${f} of ${c}.`, "lookup_fact", { country: c, fact: f });
        }
      }
    }

    // 2) do the maths with the calculator
    if (wantsMath && !calcDone) {
      const [a, b] = [countries[0], countries[1] ?? countries[0]];
      const expr = lower.includes("density")
        ? `${results[`${a}|population`]} / ${results[`${a}|area`]}`
        : `${results[`${a}|${facts[0]}`]} / ${results[`${b}|${facts[0]}`]}`;
      return call("I have all the numbers, now I will calculate it.", "calculator", { expression: expr });
    }

    // 3) final answer
    const lines = Object.entries(results).map(([k, v]) => `${k.replace("|", " ")} = ${v}`);
    const text = `Done. Facts used: ${lines.join("; ")}.` + (calcDone ? ` Result: ${calcDone}.` : "");
    return { text, toolCalls: [], raw: [{ type: "text", text }] };
  }
}

export function pickLLM(): { llm: LLM; mode: "claude" | "mock" } {
  if (process.env.ANTHROPIC_API_KEY) return { llm: new ClaudeLLM(), mode: "claude" };
  return { llm: new MockLLM(), mode: "mock" };
}
