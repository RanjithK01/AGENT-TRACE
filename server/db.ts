import { DatabaseSync } from "node:sqlite";

// one sqlite file keeps every run so I can replay and compare them later
export const db = new DatabaseSync(process.env.DB_PATH ?? "agenttrace.db");

db.exec(`
  create table if not exists runs (
    id integer primary key autoincrement,
    task text not null,
    status text not null,
    created_at integer not null,
    finished_at integer
  );
  create table if not exists steps (
    id integer primary key autoincrement,
    run_id integer not null,
    idx integer not null,
    kind text not null,
    content text not null,
    latency_ms integer default 0,
    created_at integer not null
  );
  create index if not exists steps_run on steps(run_id, idx);
`);
