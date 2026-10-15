import assert from "node:assert/strict";
import { runTool } from "./tools";

// quick checks for the tools the agent can call
assert.equal(runTool("lookup_fact", { country: "Japan", fact: "population" }), "japan population: 124 million");
assert.match(runTool("lookup_fact", { country: "Mars", fact: "population" }), /no data/);
assert.equal(runTool("calculator", { expression: "84 / 124" }), "84 / 124 = 0.677");
assert.match(runTool("calculator", { expression: "process.exit()" }), /invalid/);
assert.match(runTool("nope", {}), /unknown tool/);
console.log("all tool tests passed");
