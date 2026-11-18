import memorySourceLabels from "../../../../src/main/assistant/memory-source-labels.json";

export type MemorySource = keyof typeof memorySourceLabels;
const memorySources = Object.keys(memorySourceLabels) as MemorySource[];

export function normalizeMemorySources(value: unknown): MemorySource[] {
  return Array.isArray(value) ? memorySources.filter((source) => value.includes(source)) : [];
}

export function formatMemorySources(value: unknown, korean: boolean) {
  return normalizeMemorySources(value).map((source) => memorySourceLabels[source][korean ? "ko" : "en"]).join(" · ");
}
