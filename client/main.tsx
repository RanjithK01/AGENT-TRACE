import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Run, Step } from "./types";

async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ----- one step card in the timeline -----
function StepCard({ step, maxLatency }: { step: Step; maxLatency: number }) {
  const width = step.latency_ms > 0 ? Math.max(4, (step.latency_ms / maxLatency) * 100) : 0;
  return (
    <div className={`step k-${step.kind}`}>
      <div className="kind">
        <span>{step.kind.replace("_", " ")}</span>
        {step.latency_ms > 0 && <span>{step.latency_ms} ms</span>}
      </div>
      <pre>{step.content}</pre>
      {width > 0 && <div className="bar" style={{ width: `${width}%` }} />}
    </div>
  );
}

function Timeline({ steps }: { steps: Step[] }) {
  const maxLatency = Math.max(1, ...steps.map((s) => s.latency_ms));
  return <>{steps.map((s) => <StepCard key={s.id} step={s} maxLatency={maxLatency} />)}</>;
}

// ----- live view of one run (uses Server-Sent Events) -----
function LiveRun({ runId }: { runId: number }) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [status, setStatus] = useState("running");
  const [redirect, setRedirect] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSteps([]);
    const es = new EventSource(`/api/runs/${runId}/stream`);
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === "step") setSteps((prev) => (prev.some((s) => s.id === ev.step.id) ? prev : [...prev, ev.step]));
      if (ev.type === "status") setStatus(ev.status);
    };
    return () => es.close();
  }, [runId]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [steps.length]);

  const live = status === "running" || status === "paused";
  async function sendRedirect() {
    if (!redirect.trim()) return;
    await api(`/api/runs/${runId}/redirect`, "POST", { message: redirect.trim() });
    setRedirect("");
  }

  return (
    <div>
      <h3>Run #{runId} <span className={`badge ${status}`}>{status}</span></h3>
      <div className="row">
        {status === "paused"
          ? <button onClick={() => api(`/api/runs/${runId}/resume`, "POST")}>Resume</button>
          : <button disabled={!live} onClick={() => api(`/api/runs/${runId}/pause`, "POST")}>Pause</button>}
        <button disabled={!live} onClick={() => api(`/api/runs/${runId}/stop`, "POST")}>Stop</button>
      </div>
      <div className="row">
        <input type="text" placeholder="Redirect the agent, e.g. 'Instead look at Brazil'" value={redirect}
          disabled={!live} onChange={(e) => setRedirect(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendRedirect()} />
        <button disabled={!live || !redirect.trim()} onClick={sendRedirect}>Send redirect</button>
      </div>
      <p className="muted">Pause and redirect take effect before the agent's next step.</p>
      <Timeline steps={steps} />
      <div ref={bottom} />
    </div>
  );
}

// ----- side by side comparison of two finished runs -----
function Summary({ steps }: { steps: Step[] }) {
  const tools = steps.filter((s) => s.kind === "tool_call").length;
  const total = steps.reduce((sum, s) => sum + s.latency_ms, 0);
  return <div className="stats"><span>{steps.length} steps</span><span>{tools} tool calls</span><span>{total} ms total</span></div>;
}

function Compare({ ids }: { ids: [number, number] }) {
  const [data, setData] = useState<{ run: Run; steps: Step[] }[]>([]);
  useEffect(() => { Promise.all(ids.map((id) => api(`/api/runs/${id}`))).then(setData); }, [ids[0], ids[1]]);
  return (
    <div className="compare">
      {data.map((d) => (
        <div key={d.run.id}>
          <h3>Run #{d.run.id} <span className={`badge ${d.run.status}`}>{d.run.status}</span></h3>
          <div className="muted">{d.run.task}</div>
          <Summary steps={d.steps} />
          <Timeline steps={d.steps} />
        </div>
      ))}
    </div>
  );
}

// ----- page -----
function App() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [compare, setCompare] = useState<number[]>([]);
  const [task, setTask] = useState("Compare the population of Japan and Germany and give the ratio");

  const loadRuns = () => api("/api/runs").then(setRuns);
  useEffect(() => { loadRuns(); const t = setInterval(loadRuns, 2000); return () => clearInterval(t); }, []);

  async function startRun() {
    if (!task.trim()) return;
    const { id } = await api("/api/runs", "POST", { task });
    setCompare([]);
    setSelected(id);
    loadRuns();
  }
  const toggleCompare = (id: number) =>
    setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id].slice(-2)));

  return (
    <div className="layout">
      <aside>
        <input type="text" value={task} onChange={(e) => setTask(e.target.value)} onKeyDown={(e) => e.key === "Enter" && startRun()} />
        <div className="row"><button className="primary" onClick={startRun}>Start run</button></div>
        <p className="muted">Tick two runs to compare them side by side.</p>
        {runs.map((r) => (
          <div key={r.id} className={`run ${selected === r.id && compare.length < 2 ? "sel" : ""}`}
            onClick={() => { setSelected(r.id); setCompare([]); }}>
            <input type="checkbox" checked={compare.includes(r.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleCompare(r.id)} />{" "}
            #{r.id}<span className={`badge ${r.status}`}>{r.status}</span>
            <small>{r.task.slice(0, 60)}</small>
          </div>
        ))}
      </aside>
      <main>
        {compare.length === 2 ? <Compare ids={[compare[0], compare[1]]} />
          : selected ? <LiveRun runId={selected} />
          : <p className="muted">Start a run to see the agent's steps stream in live.</p>}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
