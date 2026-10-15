// Tools the agent is allowed to call.

const POPULATION_M: Record<string, number> = {
  japan: 124, germany: 84, india: 1430, usa: 335,
  brazil: 216, france: 68, canada: 40, australia: 26,
};
const AREA_THOUSAND_KM2: Record<string, number> = {
  japan: 378, germany: 358, india: 3287, usa: 9834,
  brazil: 8516, france: 644, canada: 9985, australia: 7692,
};

export const COUNTRIES = Object.keys(POPULATION_M);

function lookupFact(input: { country: string; fact: string }) {
  const c = String(input.country).toLowerCase();
  if (input.fact === "population" && POPULATION_M[c]) return `${c} population: ${POPULATION_M[c]} million`;
  if (input.fact === "area" && AREA_THOUSAND_KM2[c]) return `${c} area: ${AREA_THOUSAND_KM2[c]} thousand km2`;
  return `no data for ${input.country} / ${input.fact}`;
}

function calculator(input: { expression: string }) {
  const expr = String(input.expression);
  // only digits and basic operators, so nothing nasty can be evaluated
  if (!/^[0-9+\-*/().\s]+$/.test(expr)) return "error: invalid expression";
  try {
    const value = Function(`"use strict"; return (${expr})`)();
    return `${expr} = ${Math.round(value * 1000) / 1000}`;
  } catch {
    return "error: could not evaluate";
  }
}

export function runTool(name: string, input: any): string {
  if (name === "lookup_fact") return lookupFact(input);
  if (name === "calculator") return calculator(input);
  return `error: unknown tool ${name}`;
}

// tool definitions in the format the Claude API expects
export const toolDefs = [
  {
    name: "lookup_fact",
    description: "Look up a fact (population or area) about a country.",
    input_schema: {
      type: "object",
      properties: {
        country: { type: "string" },
        fact: { type: "string", enum: ["population", "area"] },
      },
      required: ["country", "fact"],
    },
  },
  {
    name: "calculator",
    description: "Evaluate a basic arithmetic expression like (84 / 124).",
    input_schema: {
      type: "object",
      properties: { expression: { type: "string" } },
      required: ["expression"],
    },
  },
];
