import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "src/connectivity.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const temporaryModule = path.join(root, ".connectivity.test.mjs");
fs.writeFileSync(temporaryModule, compiled, "utf8");

try {
  const { isReachableUnverified, isVerifiedConnectivity } = await import(`${pathToFileURL(temporaryModule).href}?t=${Date.now()}`);
  const verified = { ok: true, live_tested: true, release_status: "CONNECTED" };
  const relayLookupOnly = { ok: true, live_tested: false, release_status: "REACHABLE_UNVERIFIED" };
  const glmCredentialsOnly = { ok: true, live_tested: false, release_status: "CREDENTIALS_CONNECTED" };
  const failed = { ok: false, live_tested: true, release_status: "FAILED" };

  assert.equal(isVerifiedConnectivity(verified), true);
  assert.equal(isVerifiedConnectivity(relayLookupOnly), false, "a relay lookup 404/405 must not render as a verified model call");
  assert.equal(isReachableUnverified(relayLookupOnly), true);
  assert.equal(isVerifiedConnectivity(glmCredentialsOnly), false, "a text-only GLM credential check must not masquerade as verified multimodal extraction");
  assert.equal(isReachableUnverified(glmCredentialsOnly), true);
  assert.equal(isVerifiedConnectivity(failed), false);
  console.log("PASS mobile connectivity never presents reachability-only relay checks as verified model calls");
} finally {
  fs.rmSync(temporaryModule, { force: true });
}
