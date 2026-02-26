import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@coral-xyz/anchor";
import { initVault } from "../lib/program";
import { useProgram } from "../hooks/useProgram";


export default function Register() {
  const { publicKey } = useWallet();
  const program = useProgram();
  const [chipPubkeyHex, setChipPubkeyHex] = useState("");
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState("");
  const [limit, setLimit] = useState("");
  const [loading, setLoading] = useState(false);

  // Convert hex string to byte array
  function hexToBytes(hex: string): number[] {
    if (!hex) return [];
    let clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0) clean = "0" + clean;
    return Array.from(Buffer.from(clean, "hex"));
  }

  // Real NFC/Web NFC logic placeholder
  const handleScan = async () => {
    setStatus("Hold your NFC chip near your phone...");
    // TODO: Replace with real NFC logic (Web NFC, HaLo, etc.)
    // For now, prompt for manual entry
    setTimeout(() => {
      setStatus("Paste or scan your chip's 128-char hex public key below.");
      setStep(1);
    }, 1200);
  };

  const handleRegister = async () => {
    if (!chipPubkeyHex || !publicKey || !limit || !program) return;
    setLoading(true);
    setStatus("Registering chip on Solana...");
    try {
      const chipPubkey = hexToBytes(chipPubkeyHex);
      if (chipPubkey.length !== 64) {
        setStatus("❌ Chip public key must be 128 hex chars (64 bytes)");
        setLoading(false);
        return;
      }
      await initVault(
        program,
        publicKey,
        chipPubkey,
        new BN(limit)
      );
      setStatus("✅ Chip registered!");
      setStep(2);
    } catch (e) {
      setStatus("❌ Registration failed: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-12 p-6 bg-white rounded shadow">
      <h1 className="text-2xl font-bold mb-4">Register NFC Chip</h1>
      {step === 0 && (
        <>
          <button
            className="btn btn-primary w-full"
            onClick={handleScan}
            disabled={loading}
          >
            Scan NFC Chip
          </button>
        </>
      )}
      {step === 1 && (
        <>
          <div className="mb-2">Chip Public Key (128 hex chars):</div>
          <input
            className="input input-bordered w-full mb-4 font-mono"
            value={chipPubkeyHex}
            onChange={e => setChipPubkeyHex(e.target.value)}
            placeholder="Paste or scan chip public key"
            autoFocus
          />
          <div className="mb-2">Set Daily Limit (Lamports):</div>
          <input
            className="input input-bordered w-full mb-4"
            type="number"
            value={limit}
            onChange={e => setLimit(e.target.value)}
          />
          <button
            className="btn btn-success w-full"
            onClick={handleRegister}
            disabled={loading || !limit || !chipPubkeyHex}
          >
            Register Chip
          </button>
        </>
      )}
      {step === 2 && (
        <div className="text-green-600 font-semibold text-lg">Chip registered successfully!</div>
      )}
      <div className="mt-4 text-sm text-gray-600 min-h-[2em]">{status}</div>
    </div>
  );
}
