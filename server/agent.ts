import { EventEmitter } from "node:events";
import { db } from "./db";
import { pickLLM, Msg } from "./llm";
import { runTool } from "./tools";

export const bus = new EventEmitter();
bus.setMaxListeners(100);

const MAX_TURNS = 12;

// live control state for runs that are currently going
type Ctl = { paused: boolean; stopped: boolean; redirect: string | null; wake: (() => void) | null; idx: number };
const active = new Map<number, Ctl>();

class Stopped extends Error {}

function setStatus(runId: number, status: string) {
  const done = status === "finished" || status === "stopped" || status === "error";
  db.prepare("update runs set status = ?, finished_at = ? where id = ?").run(status, done ? Date.now() : null, runId);
  bus.emit("run:" + runId, { type: "status", status });
}

function addStep(runId: number, kind: string, content: string, latency = 0) {
  const ctl = active.get(runId)!;
  const createdAt = Date.now();
  const idx = ctl.idx++;
  const r = db.prepare(
    "insert into steps (run_id, idx, kind, content, latency_ms, created_at) values (?, ?, ?, ?, ?, ?)"
  ).run(runId, idx, kind, content, latency, createdAt);
  const step = { id: Number(r.lastInsertRowid), run_id: runId, idx, kind, content, latency_ms: latency, created_at: createdAt };
  bus.emit("run:" + runId, { type: "step", step });
}

// blocks here while the run is paused
async function gate(ctl: Ctl) {
  while (ctl.paused && !ctl.stopped) await new Promise<void>((r) => (ctl.wake = r));
  if (ctl.stopped) throw new Stopped();
}

export function startRun(task: string): number {
  const r = db.prepare("insert into runs (task, status, created_at) values (?, 'running', ?)").run(task, Date.now());
  const runId = Number(r.lastInsertRowid);
  active.set(runId, { paused: false, stopped: false, redirect: null, wake: null, idx: 0 });
  loop(runId, task).catch((e) => console.error("run crashed", e));
  return runId;
}

async function loop(runId: number, task: string) {
  const ctl = active.get(runId)!;
  const { llm, mode } = pickLLM();
  const history: Msg[] = [{ role: "user", content: task }];
  addStep(runId, "system", `Run started (${mode} model)`);

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      await gate(ctl);

      // apply a redirect, if the user sent one while we were busy
      if (ctl.redirect) {
        const text = "[REDIRECT] " + ctl.redirect;
        ctl.redirect = null;
        addStep(runId, "redirect", text);
        const last = history[history.length - 1];
        if (last.role === "user" && Array.isArray(last.content)) last.content.push({ type: "text", text });
        else history.push({ role: "user", content: text });
      }

      const t0 = Date.now();
      const res = await llm.next(history);
      const latency = Date.now() - t0;
      if (res.text && res.toolCalls.length > 0) addStep(runId, "thought", res.text, latency);
      history.push({ role: "assistant", content: res.raw });

      if (res.toolCalls.length === 0) {
        addStep(runId, "final", res.text || "(no answer)", latency);
        setStatus(runId, "finished");
        return;
      }

      const toolResults: any[] = [];
      for (const tc of res.toolCalls) {
        addStep(runId, "tool_call", `${tc.name}(${JSON.stringify(tc.input)})`);
        const t1 = Date.now();
        const output = runTool(tc.name, tc.input);
        addStep(runId, "tool_result", output, Date.now() - t1);
        toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: output });
      }
      history.push({ role: "user", content: toolResults });
    }
    addStep(runId, "error", `Stopped after ${MAX_TURNS} turns without a final answer`);
    setStatus(runId, "error");
  } catch (e: any) {
    if (e instanceof Stopped) {
      addStep(runId, "system", "Run stopped by user");
      setStatus(runId, "stopped");
    } else {
      addStep(runId, "error", String(e.message ?? e));
      setStatus(runId, "error");
    }
  } finally {
    active.delete(runId);
  }
}

export const control = {
  pause(id: number) {
    const c = active.get(id); if (!c) return false;
    c.paused = true; setStatus(id, "paused"); return true;
  },
  resume(id: number) {
    const c = active.get(id); if (!c) return false;
    c.paused = false; c.wake?.(); setStatus(id, "running"); return true;
  },
  stop(id: number) {
    const c = active.get(id); if (!c) return false;
    c.stopped = true; c.wake?.(); return true;
  },
  redirect(id: number, message: string) {
    const c = active.get(id); if (!c) return false;
    c.redirect = message; return true;
  },
};
