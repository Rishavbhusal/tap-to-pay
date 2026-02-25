import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { type NfcSmartVault } from "./idl/nfc_smart_vault";
import idlJson from "./idl/nfc_smart_vault.json";
import { PROGRAM_ID } from "./constants";

// Re-export IDL type
export type { NfcSmartVault };

// ── Vault account type (deserialized from chain) ──────────────────
export interface VaultRegistry {
  chipPubkey: number[]; // [u8; 64]
  ownerSol: PublicKey;
  nonce: BN;
  dailyLimit: BN;
  dailySpend: BN;
  lastDay: BN;
  frozen: boolean;
  bump: number;
}

// ── Get the Anchor Program instance ───────────────────────────────
export function getProgram(provider: AnchorProvider): Program<NfcSmartVault> {
  return new Program(idlJson as any, provider);
}

// ── PDA derivation ────────────────────────────────────────────────
export function getVaultPDA(
  owner: PublicKey,
  chipPubkey: number[] | Uint8Array
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.toBuffer(), Buffer.from(chipPubkey)],
    PROGRAM_ID
  );
}

// ── Instruction: init_vault ───────────────────────────────────────
export async function initVault(
  program: Program<NfcSmartVault>,
  owner: PublicKey,
  chipPubkey: number[],
  dailyLimitLamports: BN
) {
  const [registryPDA] = getVaultPDA(owner, chipPubkey);

  const tx = await program.methods
    .initVault(chipPubkey, dailyLimitLamports)
    .accounts({
      registry: registryPDA,
      owner,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return { tx, registryPDA };
}

// ── Instruction: set_limit ────────────────────────────────────────
export async function setLimit(
  program: Program<NfcSmartVault>,
  registryPDA: PublicKey,
  owner: PublicKey,
  newLimitLamports: BN
) {
  const tx = await program.methods
    .setLimit(newLimitLamports)
    .accounts({
      registry: registryPDA,
      owner,
    })
    .rpc();

  return tx;
}

// ── Instruction: emergency_freeze ─────────────────────────────────
export async function emergencyFreeze(
  program: Program<NfcSmartVault>,
  registryPDA: PublicKey,
  owner: PublicKey
) {
  const tx = await program.methods
    .emergencyFreeze()
    .accounts({
      registry: registryPDA,
      owner,
    })
    .rpc();

  return tx;
}

// ── Instruction: execute_tap ──────────────────────────────────────
export async function executeTap(
  program: Program<NfcSmartVault>,
  registryPDA: PublicKey,
  vaultAta: PublicKey,
  targetAta: PublicKey,
  solVault: PublicKey,
  targetWallet: PublicKey,
  payloadBytes: Uint8Array,
  signature: number[],
  recoveryId: number
) {
  const tx = await program.methods
    .executeTap(Buffer.from(payloadBytes), signature, recoveryId)
    .accounts({
      registry: registryPDA,
      vaultAta,
      targetAta,
      solVault,
      targetWallet,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return tx;
}

// ── Fetch a single vault account ──────────────────────────────────
export async function fetchVault(
  program: Program<NfcSmartVault>,
  registryPDA: PublicKey
): Promise<VaultRegistry | null> {
  try {
    const account = await (program.account as any).vaultRegistry.fetch(registryPDA);
    return account as VaultRegistry;
  } catch {
    return null;
  }
}

// ── Find all vaults owned by a wallet ─────────────────────────────
export async function findVaultsByOwner(
  program: Program<NfcSmartVault>,
  connection: Connection,
  owner: PublicKey
): Promise<{ pubkey: PublicKey; account: VaultRegistry }[]> {
  try {
    const accounts = await (program.account as any).vaultRegistry.all([
      {
        memcmp: {
          offset: 8 + 64, // discriminator (8) + chip_pubkey (64) → owner_sol
          bytes: owner.toBase58(),
        },
      },
    ]);
    return accounts.map((a: any) => ({
      pubkey: a.publicKey,
      account: a.account as VaultRegistry,
    }));
  } catch {
    return [];
  }
}
