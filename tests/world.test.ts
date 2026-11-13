import { expect, test } from "vitest";

import { buildWorld, escalated, render, truthId } from "../src/world/index.ts";

test("same seed, same world and documents", () => {
  expect(buildWorld(3)).toEqual(buildWorld(3));
  expect(render(buildWorld(3), 3)).toEqual(render(buildWorld(3), 3));
});

test("escalator steps on each anniversary", () => {
  expect(escalated(100.0, 0.05, "2024-03-01", "2025-02-28")).toBe(100.0);
  expect(escalated(100.0, 0.05, "2024-03-01", "2025-03-01")).toBe(105.0);
  expect(escalated(100.0, 0.05, "2024-03-01", "2026-03-01")).toBe(110.25);
});

test("every invoice and GL row traces to an arrangement", () => {
  const world = buildWorld(1);
  const { corpus, truth } = render(world, 1);
  const arrangements = new Set(world.arrangements.map((a) => truthId(a)));
  const invoices = corpus.documents.filter((d) => d.kind === "invoice");
  const gl = corpus.documents.filter((d) => d.kind === "gl_export");
  expect(invoices.length).toBeGreaterThan(0);
  expect(gl).toHaveLength(1);
  const traced = (location: string) => {
    const key = truth.get(location);
    return key !== undefined && arrangements.has(truthId(key));
  };
  expect(invoices.every((d) => traced(d.id))).toBe(true);
  const rows = Array.from({ length: (gl[0]?.lines.length ?? 0) - 1 }, (_, i) => `gl-export:${i + 2}`);
  expect(rows.every(traced)).toBe(true);
});

test("corpus does not leak hidden ids", () => {
  const world = buildWorld(1);
  const { corpus } = render(world, 1);
  const hidden = [...world.vendors.map((v) => v.id), ...world.agreements.map((a) => a.id)];
  const text = corpus.documents.flatMap((d) => [d.id, ...d.lines]).join("\n");
  expect(hidden.filter((id) => text.includes(id))).toEqual([]);
});
