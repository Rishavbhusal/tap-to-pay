import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey("6w8VdnhWQpPypZyVtYiq7ajznigpnwa72DmWGX3GveL8");

export const DEVNET_RPC = "https://api.devnet.solana.com";
export const MAINNET_RPC = "https://api.mainnet-beta.solana.com";

export const SOL_USD_MOCK_RATE = 178.42;

export const ANCHOR_ERRORS: Record<number, string> = {
  6000: "Vault is frozen. Unfreeze it from Settings to continue.",
  6001: "Invalid nonce. The transaction may be stale.",
  6002: "Timestamp is too old. Please try again.",
  6003: "NFC signature verification failed.",
  6004: "Daily spending limit exceeded. Resets at midnight UTC.",
  6005: "Nonce overflow. Contact support.",
  6006: "Invalid action type in payload.",
  6007: "Invalid program in transaction.",
  6008: "Invalid payment payload.",
  6009: "Unauthorized. Only the vault owner can perform this action.",
};

export const SOLSCAN_BASE = "https://solscan.io/tx";

export function truncateAddress(addr: string, chars = 4): string {
  if (!addr) return "";
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}

export function lamportsToSol(lamports: number): number {
  return lamports / 1e9;
}

export function solToLamports(sol: number): number {
  return Math.floor(sol * 1e9);
}

export function solToUsd(sol: number): string {
  return (sol * SOL_USD_MOCK_RATE).toFixed(2);
}
