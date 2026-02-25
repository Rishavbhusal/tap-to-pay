import { useMemo } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { type NfcSmartVault } from "@/lib/idl/nfc_smart_vault";
import { getProgram } from "@/lib/program";

/**
 * Returns an Anchor Program instance for nfc_smart_vault.
 * Returns null if the wallet is not connected.
 */
export function useProgram(): Program<NfcSmartVault> | null {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  const program = useMemo(() => {
    if (!wallet) return null;
    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    return getProgram(provider);
  }, [connection, wallet]);

  return program;
}
