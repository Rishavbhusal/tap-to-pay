import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
  Secp256k1Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
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
  const chipBuf = Buffer.from(chipPubkey);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("vault"),
      owner.toBuffer(),
      chipBuf.subarray(0, 32),
      chipBuf.subarray(32, 64),
    ],
    PROGRAM_ID
  );
}

// ── Instruction: init_vault ───────────────────────────────────────
// Uses .rpc() which goes through AnchorProvider → wallet.signTransaction()
// This reliably triggers the Phantom approval popup in its in-app browser.
export async function initVault(
  program: Program<NfcSmartVault>,
  owner: PublicKey,
  chipPubkey: number[],
  dailyLimitLamports: BN
) {
  const [registryPDA] = getVaultPDA(owner, chipPubkey);

  const sig = await program.methods
    .initVault(chipPubkey, dailyLimitLamports)
    .accounts({
      registry: registryPDA,
      owner,
    })
    .rpc();

  return { sig, registryPDA };
}

// ── Instruction: set_limit ────────────────────────────────────────
export async function setLimit(
  program: Program<NfcSmartVault>,
  registryPDA: PublicKey,
  owner: PublicKey,
  newLimitLamports: BN
): Promise<string> {
  return program.methods
    .setLimit(newLimitLamports)
    .accounts({
      registry: registryPDA,
      owner,
    })
    .rpc();
}

// ── Instruction: emergency_freeze ─────────────────────────────────
export async function emergencyFreeze(
  program: Program<NfcSmartVault>,
  registryPDA: PublicKey,
  owner: PublicKey
): Promise<string> {
  return program.methods
    .emergencyFreeze()
    .accounts({
      registry: registryPDA,
      owner,
    })
    .rpc();
}

// ── Instruction: unfreeze ─────────────────────────────────────────
export async function unfreezeVault(
  program: Program<NfcSmartVault>,
  registryPDA: PublicKey,
  owner: PublicKey
): Promise<string> {
  return program.methods
    .unfreeze()
    .accounts({
      registry: registryPDA,
      owner,
    })
    .rpc();
}

// ── Instruction: execute_tap ──────────────────────────────────────
// Uses the Secp256k1 native precompile for signature verification
// instead of the expensive libsecp256k1::recover on-chain (~200k CUs).
// The precompile runs as a separate instruction in the same transaction
// and costs only a few hundred CUs.
export async function executeTap(
  program: Program<NfcSmartVault>,
  registryPDA: PublicKey,
  vaultAta: PublicKey,
  targetAta: PublicKey,
  solVault: PublicKey,
  targetWallet: PublicKey,
  payloadBytes: Uint8Array,
  signature: number[],
  recoveryId: number,
  chipPubkey: number[] | Uint8Array
): Promise<string> {
  // Build the secp256k1 precompile instruction.
  // The precompile takes the raw message (payload_bytes), internally
  // hashes it with keccak256, then does ecrecover. This matches what
  // the HaLo NFC chip signed (keccak256 of payload_bytes).
  const secp256k1Ix = Secp256k1Program.createInstructionWithPublicKey({
    publicKey: Buffer.from(chipPubkey),
    message: Buffer.from(payloadBytes),
    signature: Buffer.from(signature),
    recoveryId,
    instructionIndex: 0xFF, // 0xFF = read from own instruction data (not positional)
  });

  return program.methods
    .executeTap(Buffer.from(payloadBytes), Array.from(signature), recoveryId)
    .accounts({
      registry: registryPDA,
      vaultAta,
      targetAta,
      solVault,
      targetWallet,
    })
    .preInstructions([
      // 1️⃣ Compute budget MUST be first — increases from default 200k
      ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
      // 2️⃣ Priority fee (prevents Phantom from injecting its own ComputeBudget ix)
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
      // 3️⃣ Secp256k1 precompile — signature verified natively by validator
      secp256k1Ix,
    ])
    .rpc();
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
