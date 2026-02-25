/**
 * Re-exports from the program module.
 * This file is kept for backward compatibility.
 */
export type { VaultRegistry, NfcSmartVault } from "./program";
export {
  getProgram,
  getVaultPDA,
  initVault,
  setLimit,
  emergencyFreeze,
  executeTap,
  fetchVault,
  findVaultsByOwner,
} from "./program";
