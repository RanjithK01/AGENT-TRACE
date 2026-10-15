import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { bus, startRun, control } from "./agent";

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC = path.join(import.meta.dirname, "..", "public");
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
  });
}

// Server-Sent Events: replay the saved steps, then push new ones as they happen
function stream(runId: number, req: http.IncomingMessage, res: http.ServerResponse) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (ev: unknown) => res.write(`data: ${JSON.stringify(ev)}\n\n`);

  let lastIdx = -1;
  const onEvent = (ev: any) => {
    if (ev.type === "step") { if (ev.step.idx <= lastIdx) return; lastIdx = ev.step.idx; }
    send(ev);
  };
  bus.on("run:" + runId, onEvent);

  const saved = db.prepare("select * from steps where run_id = ? order by idx").all(runId) as any[];
  for (const s of saved) { lastIdx = s.idx; send({ type: "step", step: s }); }
  const run = db.prepare("select status from runs where id = ?").get(runId) as any;
  if (run) send({ type: "status", status: run.status });

  req.on("close", () => bus.off("run:" + runId, onEvent));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;

  if (p === "/api/runs" && req.method === "GET") {
    return json(res, 200, db.prepare("select * from runs order by id desc limit 50").all());
  }
  if (p === "/api/runs" && req.method === "POST") {
    const { task } = await readBody(req);
    if (!task || typeof task !== "string") return json(res, 400, { error: "task is required" });
    return json(res, 201, { id: startRun(task.trim()) });
  }

  const m = p.match(/^\/api\/runs\/(\d+)(?:\/(\w+))?$/);
  if (m) {
    const id = Number(m[1]);
    const action = m[2];
    if (req.method === "GET" && !action) {
      const run = db.prepare("select * from runs where id = ?").get(id);
      if (!run) return json(res, 404, { error: "run not found" });
      const steps = db.prepare("select * from steps where run_id = ? order by idx").all(id);
      return json(res, 200, { run, steps });
    }
    if (req.method === "GET" && action === "stream") return stream(id, req, res);
    if (req.method === "POST" && action && ["pause", "resume", "stop", "redirect"].includes(action)) {
      let ok = false;
      if (action === "redirect") {
        const { message } = await readBody(req);
        if (!message) return json(res, 400, { error: "message is required" });
        ok = control.redirect(id, String(message));
      } else {
        ok = (control as any)[action](id);
      }
      return ok ? json(res, 200, { ok: true }) : json(res, 409, { error: "run is not active" });
    }
  }

  // static files
  const file = path.join(PUBLIC, p === "/" ? "index.html" : p);
  if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    return fs.createReadStream(file).pipe(res);
  }
  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => console.log(`AgentTrace running on http://localhost:${PORT}`));
