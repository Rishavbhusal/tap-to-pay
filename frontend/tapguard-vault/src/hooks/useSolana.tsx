import React, { createContext, useContext, useState, useMemo, ReactNode, useCallback } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { DEVNET_RPC, MAINNET_RPC, lamportsToSol } from "@/lib/constants";
import { useProgram } from "@/hooks/useProgram";
import { VaultRegistry, findVaultsByOwner } from "@/lib/program";

type Network = "devnet" | "mainnet-beta";

interface SolanaContextType {
  network: Network;
  setNetwork: (n: Network) => void;
  connection: Connection;
  balance: number | null;
  vault: VaultRegistry | null;
  vaultPDA: PublicKey | null;
  hasVault: boolean;
  refreshBalance: () => Promise<void>;
  refreshVault: () => Promise<void>;
  loading: boolean;
  vaultLoading: boolean;
}

const SolanaContext = createContext<SolanaContextType | null>(null);

export function SolanaProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<Network>("devnet");
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [vault, setVault] = useState<VaultRegistry | null>(null);
  const [vaultPDA, setVaultPDA] = useState<PublicKey | null>(null);
  const { publicKey } = useWallet();
  const program = useProgram();

  const connection = useMemo(
    () => new Connection(network === "devnet" ? DEVNET_RPC : MAINNET_RPC, "confirmed"),
    [network]
  );

  const refreshBalance = useCallback(async () => {
    if (!publicKey) {
      setBalance(null);
      return;
    }
    try {
      setLoading(true);
      const bal = await connection.getBalance(publicKey);
      setBalance(lamportsToSol(bal));
    } catch {
      setBalance(null);
    } finally {
      setLoading(false);
    }
  }, [publicKey, connection]);

  const refreshVault = useCallback(async () => {
    if (!publicKey || !program) {
      setVault(null);
      setVaultPDA(null);
      return;
    }
    try {
      setVaultLoading(true);
      const vaults = await findVaultsByOwner(program, connection, publicKey);
      if (vaults.length > 0) {
        setVault(vaults[0].account);
        setVaultPDA(vaults[0].pubkey);
      } else {
        setVault(null);
        setVaultPDA(null);
      }
    } catch (err) {
      console.error("Failed to fetch vault:", err);
      setVault(null);
      setVaultPDA(null);
    } finally {
      setVaultLoading(false);
    }
  }, [publicKey, program, connection]);

  const hasVault = vault !== null;

  React.useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  React.useEffect(() => {
    refreshVault();
  }, [refreshVault]);

  return (
    <SolanaContext.Provider
      value={{
        network,
        setNetwork,
        connection,
        balance,
        vault,
        vaultPDA,
        hasVault,
        refreshBalance,
        refreshVault,
        loading,
        vaultLoading,
      }}
    >
      {children}
    </SolanaContext.Provider>
  );
}

export function useSolana() {
  const ctx = useContext(SolanaContext);
  if (!ctx) throw new Error("useSolana must be used within SolanaProvider");
  return ctx;
}
