import { useState } from "react";

// Only import if running in browser
let halo: any = null;
if (typeof window !== "undefined") {
  try {
    halo = require("@arx-research/libhalo");
  } catch {}
}

export function useHaloChip() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Returns { address, signature } or throws
  const getChipPublicKey = async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (!halo) throw new Error("HaLo library not available");
      // Send 'init' message to chip, get public key
      const result = await halo.execHaloCmdWeb({
        name: "sign",
        keyNo: 1,
        message: "init",
        format: "text",
      });
      setIsLoading(false);
      return result; // { address, signature }
    } catch (e: any) {
      setError(e.message || "Unknown error");
      setIsLoading(false);
      throw e;
    }
  };

  return { getChipPublicKey, isLoading, error };
}
