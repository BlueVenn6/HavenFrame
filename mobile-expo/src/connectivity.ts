import type { ModelConnectivityResult } from "./types";

export function isVerifiedConnectivity(result?: ModelConnectivityResult | null): boolean {
  if (!result?.ok || result.live_tested !== true) return false;
  const status = String(result.release_status || "").toUpperCase();
  return status === "CONNECTED" || status === "PASS";
}

export function isReachableUnverified(result?: ModelConnectivityResult | null): boolean {
  const status = String(result?.release_status || "").toUpperCase();
  return status === "REACHABLE_UNVERIFIED" || status === "CREDENTIALS_CONNECTED";
}
