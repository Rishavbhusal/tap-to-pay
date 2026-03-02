import { useState } from "react";

/**
 * Parse a HaLo chip redirect URL (e.g. from nfc.ethglobal.com)
 * EthGlobal format: ?av=A02.03...&v=01.G1...&pk1=04...&pk2=04...&rnd=...&rndsig=...
 * pk1 = secp256k1 public key (slot 1)
 */
export function parseHaloUrl(url: string): { pk1: string; pk2: string; raw: string } | null {
  try {
    const trimmed = url.trim();
    
    // Try to extract query string even from partial/broken URLs
    let searchStr = "";
    
    if (trimmed.includes("?")) {
      searchStr = trimmed.substring(trimmed.indexOf("?"));
    } else if (trimmed.includes("pk1=")) {
      // Raw params without ?
      searchStr = "?" + trimmed.substring(trimmed.indexOf("pk1="));
    } else if (trimmed.includes("&")) {
      searchStr = "?" + trimmed;
    }
    
    if (!searchStr) return null;
    
    const params = new URLSearchParams(searchStr);

    // Try pk1 first (EthGlobal format), then static (some HaLo formats)
    const pk1 = params.get("pk1") || params.get("static") || "";
    const pk2 = params.get("pk2") || "";

    if (!pk1) return null;

    return { pk1, pk2, raw: url };
  } catch {
    return null;
  }
}

/**
 * Convert a compressed (33-byte) or uncompressed (65-byte) secp256k1 public key
 * to the 64-byte (128 hex char) uncompressed format without prefix that the
 * Solana program expects (chip_pubkey: [u8; 64]).
 * 
 * If the key starts with 04 (uncompressed), strip the prefix.
 * If it's 33 bytes (compressed), we store it as-is padded to 64 bytes for now.
 */
export function normalizeChipPubkey(hexKey: string): string {
  const clean = hexKey.replace(/^0x/, "").toLowerCase();

  // 130 hex chars = 65 bytes uncompressed with 04 prefix → strip prefix → 128 hex
  if (clean.length === 130 && clean.startsWith("04")) {
    return clean.slice(2);
  }

  // Already 128 hex chars = 64 bytes (uncompressed without prefix)
  if (clean.length === 128) {
    return clean;
  }

  // 66 hex chars = 33 bytes compressed key → pad to 64 bytes
  if (clean.length === 66 && (clean.startsWith("02") || clean.startsWith("03"))) {
    return clean.padEnd(128, "0");
  }

  // Return as-is if format unknown
  return clean;
}

export function useHaloChip() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Try to scan via Web NFC (Android Chrome only).
   * Falls back with an error on iOS or unsupported browsers.
   */
  const getChipPublicKey = async (): Promise<{ address: string } | null> => {
    setIsLoading(true);
    setError(null);
    try {
      // MUST use the /api/web sub-path — the main entry exports nothing
      const { execHaloCmdWeb } = await import("@arx-research/libhalo/api/web");

      const result = await execHaloCmdWeb({
        name: "get_pkeys",
      });

      // result.publicKeys is { 1: "04abcdef...", 2: "04..." }
      const pk1: string | undefined = result?.publicKeys?.[1];
      if (!pk1) {
        setIsLoading(false);
        return null;
      }

      const normalized = normalizeChipPubkey(pk1);
      setIsLoading(false);
      return { address: normalized };
    } catch (e: any) {
      setError(e.message || "Unknown error");
      setIsLoading(false);
      throw e;
    }
  };

  /**
   * Extract public key from a pasted HaLo redirect URL.
   * Works on any platform — user taps NFC, copies the redirect URL, pastes it.
   */
  const getChipFromUrl = (url: string): { address: string } | null => {
    const parsed = parseHaloUrl(url);
    if (!parsed || !parsed.pk1) return null;
    const normalized = normalizeChipPubkey(parsed.pk1);
    return { address: normalized };
  };

  return { getChipPublicKey, getChipFromUrl, isLoading, error };
}
