export type Step = {
  id: number; run_id: number; idx: number;
  kind: "system" | "thought" | "tool_call" | "tool_result" | "redirect" | "final" | "error";
  content: string; latency_ms: number; created_at: number;
};
export type Run = { id: number; task: string; status: string; created_at: number; finished_at: number | null };
