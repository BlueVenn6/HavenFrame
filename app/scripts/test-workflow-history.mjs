import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const sourceUrl = new URL("../src/lib/workflow-history.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: "workflow-history.ts",
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const { latestOutputForModule } = await import(moduleUrl);

const assets = [
  {
    id: 10,
    project_id: 2,
    type: "floorplan",
    source: "floorplan",
    created_at: "2026-07-12T10:00:00Z",
    metadata_json: { module: "floorplan", source_asset_ids: [1] },
  },
  {
    id: 11,
    project_id: 2,
    type: "floorplan",
    source: "floorplan",
    created_at: "2026-07-12T11:00:00Z",
    metadata_json: { module: "floorplan", source_asset_ids: [2] },
  },
  {
    id: 12,
    project_id: 2,
    type: "render_output",
    source: "custom_tasks",
    created_at: "2026-07-12T12:00:00Z",
    metadata_json: { module: "custom_tasks", source_asset_ids: [] },
  },
];

assert.equal(latestOutputForModule(assets, "floorplan", 2, []), undefined);
assert.equal(latestOutputForModule(assets, "floorplan", 2, [1])?.id, 10);
assert.equal(latestOutputForModule(assets, "floorplan", 2, [2])?.id, 11);
assert.equal(latestOutputForModule(assets, "custom_tasks", 2, [], true)?.id, 12);

console.log("PASS workflow history input isolation");
