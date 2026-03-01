import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  CheckCircle,
  Loader2,
  Smartphone,
  XCircle,
  ExternalLink,
  Wallet,
} from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { solToUsd, PROGRAM_ID, solToLamports, SOLSCAN_BASE } from "@/lib/constants";
import { useSolana } from "@/hooks/useSolana";
import { useProgram } from "@/hooks/useProgram";
import { executeTap, getVaultPDA } from "@/lib/program";
import {
  serializeTapPayload,
  hashPayload,
  hexToBytes,
  type TapPayloadFields,
} from "@/lib/payload";
import { toast } from "sonner";

type TapState = "idle" | "waiting" | "verifying" | "success" | "error";

export default function TapPage() {
  const [amount, setAmount] = useState("0.1");
  const [targetAddress, setTargetAddress] = useState("");
  const [state, setState] = useState<TapState>("idle");
  const [txSig, setTxSig] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const { connected, publicKey } = useWallet();
  const { vault, vaultPDA, refreshVault, network } = useSolana();
  const program = useProgram();

  // Refresh vault data on mount
  useEffect(() => {
    refreshVault();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    setState("idle");
    setTxSig("");
    setErrorMsg("");
  };

  const startTap = async () => {
    if (!program || !publicKey || !vault || !vaultPDA) {
      toast.error("Wallet not connected or vault not found");
      return;
    }

    // Validate target address
    let targetPubkey: PublicKey;
    try {
      targetPubkey = new PublicKey(targetAddress.trim());
    } catch {
      toast.error("Invalid target wallet address");
      return;
    }

    const amountFloat = parseFloat(amount);
    if (!amountFloat || amountFloat <= 0) {
      toast.error("Enter a valid amount");
      return;
    }

    const amountLamports = new BN(solToLamports(amountFloat));
    const nonce = vault.nonce;
    const nowSec = new BN(Math.floor(Date.now() / 1000));

    // Build the TapPayload
    const payload: TapPayloadFields = {
      programId: PROGRAM_ID,
      ownerSol: vault.ownerSol,
      action: 1, // SOL transfer
      mint: SystemProgram.programId, // null mint for SOL
      amount: amountLamports,
      target: targetPubkey,
      nonce,
      timestamp: nowSec,
    };

    const payloadBytes = serializeTapPayload(payload);
    const digestHex = hashPayload(payloadBytes);

    // Show NFC tap screen
    setState("waiting");
    toast.info("Hold your NFC chip near your phone...");

    try {
      // Sign via HaLo NFC chip
      const halo = await import("@arx-research/libhalo");
      const execFn = halo.execHaloCmdWeb ?? (halo as any).default?.execHaloCmdWeb;
      if (!execFn) throw new Error("HaLo library not available. Use Android Chrome.");

      const haloResult = await execFn({
        name: "sign",
        keyNo: 1,
        digest: digestHex,
      });

      if (!haloResult?.signature?.raw) {
        throw new Error("No signature returned from NFC chip");
      }

      const { r, s, v } = haloResult.signature.raw;
      // Convert r,s hex to byte arrays, combine into [u8; 64]
      const rBytes = hexToBytes(r);
      const sBytes = hexToBytes(s);
      const sigBytes: number[] = [...rBytes, ...sBytes];
      const recoveryId = v - 27; // HaLo returns 27/28, contract expects 0/1

      setState("verifying");

      // Build accounts for execute_tap (SOL transfer)
      // For SOL transfer, vault_ata and target_ata are not used but must be passed
      const chipPubkey = vault.chipPubkey;
      const [derivedPDA] = getVaultPDA(publicKey, chipPubkey);

      const tx = await executeTap(
        program,
        vaultPDA,
        vaultPDA,        // vault_ata placeholder (not used for SOL)
        targetPubkey,    // target_ata placeholder (not used for SOL)
        derivedPDA,      // sol_vault = the PDA that holds SOL
        targetPubkey,    // target_wallet
        payloadBytes,
        sigBytes,
        recoveryId
      );

      setTxSig(tx);
      setState("success");
      toast.success("Payment confirmed on Solana!");
      refreshVault();
    } catch (err: any) {
      console.error("execute_tap failed:", err);
      const msg = err?.message || "Transaction failed";
      setErrorMsg(msg);
      setState("error");
      toast.error(msg);
    }
  };

  if (!connected) {
    return (
      <motion.div
        className="fixed inset-0 z-40 bg-background/90 backdrop-blur-xl flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <motion.div
          className="glass-card p-10 text-center max-w-sm mx-4"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1 }}
        >
          <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-6">
            <Wallet className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Connect Your Wallet</h2>
          <p className="text-muted-foreground text-sm mb-6">
            Connect a Solana wallet to make tap payments.
          </p>
          <WalletMultiButton />
        </motion.div>
      </motion.div>
    );
  }

  if (!vault) {
    return (
      <div className="container py-10 max-w-md text-center">
        <div className="glass-card p-12">
          <Zap className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">No Vault Found</h2>
          <p className="text-muted-foreground text-sm mb-6">
            Create a vault first from the Setup page.
          </p>
          <Button asChild className="rounded-xl bg-primary text-primary-foreground">
            <a href="/setup">Set Up Vault</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-10 max-w-md">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold mb-1">Tap to Pay</h1>
          <p className="text-muted-foreground text-sm">NFC-authenticated SOL transfer</p>
        </div>

        <AnimatePresence mode="wait">
          {/* ── Idle: enter payment details ── */}
          {state === "idle" && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="glass-card p-8 space-y-5"
            >
              <div>
                <label className="text-sm text-muted-foreground mb-1.5 block">
                  Recipient Wallet Address
                </label>
                <Input
                  placeholder="Enter Solana address..."
                  value={targetAddress}
                  onChange={(e) => setTargetAddress(e.target.value)}
                  className="font-mono text-xs bg-muted border-border"
                />
              </div>

              <div>
                <label className="text-sm text-muted-foreground mb-1.5 block">
                  Amount (SOL)
                </label>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="text-3xl font-bold text-center h-16 bg-muted border-border"
                  step="0.01"
                  min="0.001"
                />
                <p className="text-center text-sm text-muted-foreground mt-1">
                  ≈ ${solToUsd(parseFloat(amount) || 0)}
                </p>
              </div>

              {vault.frozen && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-sm text-destructive text-center">
                  Vault is frozen. Unfreeze from Settings to make payments.
                </div>
              )}

              <Button
                onClick={startTap}
                className="w-full btn-glow bg-primary text-primary-foreground rounded-xl h-14 text-base"
                disabled={
                  !amount ||
                  parseFloat(amount) <= 0 ||
                  !targetAddress.trim() ||
                  vault.frozen
                }
              >
                <Smartphone className="mr-2 w-5 h-5" />
                Sign with NFC & Pay
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                Requires Android Chrome with Web NFC support.
                <br />
                Tap your HaLo chip when prompted.
              </p>
            </motion.div>
          )}

          {/* ── Waiting for NFC tap ── */}
          {state === "waiting" && (
            <motion.div
              key="waiting"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="glass-card p-12 text-center"
            >
              <div className="relative w-28 h-28 mx-auto mb-6">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="absolute inset-0 rounded-full border border-primary/40"
                    animate={{ scale: [0.8, 2], opacity: [0.6, 0] }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      delay: i * 0.5,
                    }}
                  />
                ))}
                <div className="absolute inset-0 flex items-center justify-center">
                  <Zap className="w-12 h-12 text-primary pulse-nfc" />
                </div>
              </div>
              <h2 className="text-xl font-bold mb-1">Tap your NFC chip</h2>
              <p className="text-muted-foreground text-sm mb-2">
                {amount} SOL → {targetAddress.slice(0, 6)}...
                {targetAddress.slice(-4)}
              </p>
              <p className="text-xs text-muted-foreground">
                Hold the chip near your phone's NFC reader
              </p>
              <Button
                variant="outline"
                onClick={reset}
                className="mt-6 rounded-xl border-border"
              >
                Cancel
              </Button>
            </motion.div>
          )}

          {/* ── Verifying on chain ── */}
          {state === "verifying" && (
            <motion.div
              key="verifying"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="glass-card p-12 text-center"
            >
              <Loader2 className="w-12 h-12 text-primary mx-auto mb-4 animate-spin" />
              <h2 className="text-xl font-bold mb-1">Verifying on-chain...</h2>
              <p className="text-muted-foreground text-sm">
                Confirming transaction on Solana
              </p>
            </motion.div>
          )}

          {/* ── Success ── */}
          {state === "success" && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="glass-card p-12 text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 300 }}
              >
                <CheckCircle
                  className="w-20 h-20 text-success mx-auto mb-4"
                  style={{
                    filter:
                      "drop-shadow(0 0 20px hsl(var(--success) / 0.5))",
                  }}
                />
              </motion.div>
              <h2 className="text-2xl font-bold mb-1 text-success">
                Payment Confirmed
              </h2>
              <p className="text-3xl font-bold mb-1">{amount} SOL</p>
              <p className="text-muted-foreground text-sm mb-2">
                ${solToUsd(parseFloat(amount))}
              </p>

              {txSig && (
                <a
                  href={`${SOLSCAN_BASE}/${txSig}?cluster=${network}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline mb-4"
                >
                  View on Solscan <ExternalLink className="w-3 h-3" />
                </a>
              )}

              <div className="mt-4">
                <Button
                  onClick={reset}
                  className="rounded-xl bg-primary text-primary-foreground"
                >
                  New Payment
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Error ── */}
          {state === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="glass-card p-12 text-center"
            >
              <XCircle className="w-16 h-16 text-destructive mx-auto mb-4" />
              <h2 className="text-xl font-bold mb-2 text-destructive">
                Payment Failed
              </h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-xs mx-auto break-words">
                {errorMsg}
              </p>
              <Button
                onClick={reset}
                className="rounded-xl bg-primary text-primary-foreground"
              >
                Try Again
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
