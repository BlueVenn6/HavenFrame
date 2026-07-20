import { useEffect, useState } from "react";

import { getAssetContentUrl, subscribeLocalSession } from "../api/client";

export function useAssetContentUrl(assetId?: number | null): string | undefined {
  const [version, setVersion] = useState(0);

  useEffect(() => subscribeLocalSession(() => setVersion((current) => current + 1)), []);

  return getAssetContentUrl(assetId, version);
}
