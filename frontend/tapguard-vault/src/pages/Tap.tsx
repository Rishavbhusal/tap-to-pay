import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import MobileWalletHelper from "@/components/MobileWalletHelper";
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
import { solToUsd, PROGRAM_ID, solToLamports, lamportsToSol, SOLSCAN_BASE, ANCHOR_ERRORS } from "@/lib/constants";
import { useSolana } from "@/hooks/useSolana";
import { useProgram } from "@/hooks/useProgram";
import { executeTap, getVaultPDA } from "@/lib/program";
import {
  serializeTapPayload,
  hashPayload,
  hexToBytes,
  bytesToHex,
  padTo32,
  type TapPayloadFields,
} from "@/lib/payload";
import { toast } from "sonner";

type TapState = "idle" | "waiting" | "verifying" | "success" | "error" | "nfc_done_mobile";

/** Parse Anchor/program errors into a human-readable message */
function parseAnchorError(err: any): string {
  const raw = err?.message || String(err);
  // Match "custom program error: 0xHEX" — Anchor errors are 6000+ (0x1770+)
  const hexMatch = raw.match(/custom program error:\s*0x([0-9a-fA-F]+)/);
  if (hexMatch) {
    const code = parseInt(hexMatch[1], 16);
    // Anchor custom errors start at 6000 (0x1770)
    if (code >= 6000 && ANCHOR_ERRORS[code]) {
      return ANCHOR_ERRORS[code];
    }
    // Low codes (< 0x100) are Solana built-in or native program errors
    // Do NOT map them to Anchor errors
    if (code < 0x100) {
      // Check which instruction failed to give better context
      const ixMatch = raw.match(/Instruction (\d+)/i);
      const ixIdx = ixMatch ? parseInt(ixMatch[1]) : -1;
      // Built-in Solana error descriptions
      const builtinErrors: Record<number, string> = {
        0x0: "Custom error",
        0x1: "Invalid instruction data",
        0x2: "Invalid account data",
        0x3: "Account data too small",
        0x4: "Insufficient funds",
        0x5: "Incorrect program ID",
        0x6: "Missing required signature",
        0x7: "Account already initialized",
        0x8: "Uninitialized account",
      };
      const desc = builtinErrors[code] || `Unknown error 0x${code.toString(16)}`;
      if (ixIdx >= 0) {
        return `${desc} (instruction ${ixIdx}). Check that the vault has enough SOL and all accounts are correct.`;
      }
      return desc;
    }
  }
  return raw;
}

/** Detect mobile device */
function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
}

/** Detect if running inside Phantom's in-app browser */
function isPhantomBrowser(): boolean {
  const ua = navigator.userAgent || "";
  return /Phantom/i.test(ua) || !!(window as any).solana?.isPhantom;
}

export default function TapPage() {
  const [amount, setAmount] = useState("0.1");
  const [targetAddress, setTargetAddress] = useState("");
  const [state, setState] = useState<TapState>("idle");
  const [txSig, setTxSig] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const { connected, publicKey } = useWallet();
  const { vault, vaultPDA, refreshVault, network } = useSolana();
  const program = useProgram();
  const [searchParams] = useSearchParams();

  const isMobile = isMobileDevice();
  const inPhantom = isPhantomBrowser();
  const isMobileChromeFlow = isMobile && !inPhantom;

  // State for NFC signature data passed from Chrome via URL params
  const [nfcPayloadHex, setNfcPayloadHex] = useState("");
  const [nfcSigHex, setNfcSigHex] = useState("");
  const [nfcRecoveryId, setNfcRecoveryId] = useState(0);

  // If opened in Phantom from deep link with NFC signature data
  useEffect(() => {
    const sig = searchParams.get('sig');
    const payload = searchParams.get('payload');
    const rv = searchParams.get('rv');
    const amt = searchParams.get('amount');
    const tgt = searchParams.get('target');
    if (sig && payload && rv !== null && amt && tgt) {
      setNfcSigHex(sig);
      setNfcPayloadHex(payload);
      setNfcRecoveryId(parseInt(rv, 10));
      setAmount(amt);
      setTargetAddress(tgt);
      // Auto-advance to confirming state so user just signs the wallet tx
      setState("verifying");
    }
  }, [searchParams]);

  // Submit the execute_tap transaction using pre-signed NFC data (from URL params in Phantom)
  const submitNfcTx = useCallback(async () => {
    if (!program || !publicKey || !vault || !vaultPDA) {
      toast.error("Wallet not connected or vault not found");
      return;
    }
    try {
      let targetPubkey: PublicKey;
      try {
        targetPubkey = new PublicKey(targetAddress.trim());
      } catch {
        toast.error("Invalid target wallet address");
        return;
      }

      const payloadBytes = hexToBytes(nfcPayloadHex);
      const sigBytes = [...hexToBytes(nfcSigHex)];
      const chipPubkey = vault.chipPubkey;
      const [derivedPDA] = getVaultPDA(publicKey, chipPubkey);

      // Debug: log vault state for deep-link flow
      console.log("[submitNfcTx] Vault state:", {
        dailyLimit: vault.dailyLimit.toString(),
        dailySpend: vault.dailySpend.toString(),
        nonce: vault.nonce.toString(),
        frozen: vault.frozen,
      });
      console.log("[submitNfcTx] sigBytes length:", sigBytes.length, "recoveryId:", nfcRecoveryId);

      const txSigResult = await executeTap(
        program,
        vaultPDA,
        vaultPDA,
        targetPubkey,
        derivedPDA,
        targetPubkey,
        payloadBytes,
        sigBytes,
        nfcRecoveryId,
        chipPubkey
      );

      setTxSig(txSigResult);
      setState("success");
      toast.success("Payment confirmed on Solana!");
      refreshVault();
    } catch (err: any) {
      console.error("execute_tap failed:", err);
      const msg = parseAnchorError(err);
      setErrorMsg(msg);
      setState("error");
      toast.error(msg);
    }
  }, [program, publicKey, vault, vaultPDA, targetAddress, nfcPayloadHex, nfcSigHex, nfcRecoveryId, refreshVault]);

  // When we arrive in Phantom with NFC data and wallet is connected, auto-submit
  useEffect(() => {
    if (state === "verifying" && nfcPayloadHex && nfcSigHex && connected && vault) {
      submitNfcTx();
    }
  }, [state, nfcPayloadHex, nfcSigHex, connected, vault, submitNfcTx]);

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

    // ── Debug: log vault state vs payload values ──
    console.log("[TapPage] Vault state:", {
      dailyLimit: vault.dailyLimit.toString(),
      dailySpend: vault.dailySpend.toString(),
      nonce: vault.nonce.toString(),
      frozen: vault.frozen,
      lastDay: vault.lastDay.toString(),
    });
    console.log("[TapPage] Payload values:", {
      amountLamports: amountLamports.toString(),
      nonce: nonce.toString(),
      timestamp: nowSec.toString(),
    });

    // ── Pre-flight: check daily limit before sending tx ──
    // When daily_limit is u64::MAX (set during init as "unlimited"), skip the check
    // because BN.toNumber() can't handle values above Number.MAX_SAFE_INTEGER.
    const MAX_U64 = new BN("18446744073709551615");
    const isUnlimited = vault.dailyLimit.gte(MAX_U64);
    if (!isUnlimited) {
      const currentDay = new BN(Math.floor(Date.now() / 1000 / 86400));
      let effectiveSpend = vault.dailySpend;
      if (currentDay.gt(vault.lastDay)) {
        effectiveSpend = new BN(0); // would reset on-chain
      }
      if (effectiveSpend.add(amountLamports).gt(vault.dailyLimit)) {
        const limitSol = lamportsToSol(vault.dailyLimit.toNumber());
        const spentSol = lamportsToSol(effectiveSpend.toNumber());
        toast.error(`Daily limit exceeded. Spent: ${spentSol} SOL, Limit: ${limitSol} SOL. Increase limit in Settings.`);
        setErrorMsg(`Daily limit exceeded (spent ${spentSol} / ${limitSol} SOL). Increase your daily limit in Settings.`);
        setState("error");
        return;
      }
    }

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

    // Check Web NFC support before attempting NFC sign
    const hasWebNFC = (() => {
      try { return typeof (window as any).NDEFReader === "function"; } catch { return false; }
    })();
    const inPhantom = /Phantom/i.test(navigator.userAgent) || !!(window as any).solana?.isPhantom;

    if (!hasWebNFC) {
      const reason = inPhantom
        ? "Web NFC is not available inside Phantom's browser. Open this page in Chrome on Android to use NFC tap-to-pay."
        : "Web NFC is not supported in this browser. Use Chrome on Android.";
      setErrorMsg(reason);
      setState("error");
      toast.error(reason);
      return;
    }

    // Show NFC tap screen
    setState("waiting");
    toast.info("Hold your NFC chip near your phone...");

    try {
      // Sign via HaLo NFC chip
      // MUST use the /api/web sub-path — the main entry exports nothing
      const { execHaloCmdWeb } = await import("@arx-research/libhalo/api/web");

      const haloResult = await execHaloCmdWeb({
        name: "sign",
        keyNo: 1,
        digest: digestHex,
      });

      if (!haloResult?.signature?.raw) {
        throw new Error("No signature returned from NFC chip");
      }

      const { r, s, v } = haloResult.signature.raw;
      // Convert r,s hex to byte arrays, pad each to exactly 32 bytes, combine into [u8; 64]
      // The HaLo chip may return r/s with variable length; the Secp256k1 precompile
      // requires exactly 64 bytes for the signature, and the SDK uses signature.length
      // for internal offset calculations — a mismatch causes InvalidInstructionDataSize.
      const rBytes = padTo32(hexToBytes(r));
      const sBytes = padTo32(hexToBytes(s));
      const sigBytes: number[] = [...rBytes, ...sBytes];
      const recoveryId = v - 27; // HaLo returns 27/28, contract expects 0/1

      // On mobile Chrome: deep-link to Phantom with NFC signature data
      if (isMobileChromeFlow) {
        const sigHex = bytesToHex(new Uint8Array(sigBytes));
        const payloadHex = bytesToHex(new Uint8Array(payloadBytes));
        const tapUrl = `${window.location.origin}/tap?sig=${sigHex}&payload=${payloadHex}&rv=${recoveryId}&amount=${amount}&target=${targetAddress.trim()}`;
        const phantomUrl = `https://phantom.app/ul/browse/${encodeURIComponent(tapUrl)}`;
        setState("nfc_done_mobile");
        toast.success("NFC signed! Opening Phantom to complete payment...");
        setTimeout(() => { window.location.href = phantomUrl; }, 1500);
        return;
      }

      setState("verifying");

      // Build accounts for execute_tap (SOL transfer)
      // For SOL transfer, vault_ata and target_ata are not used but must be passed
      const chipPubkey = vault.chipPubkey;
      const [derivedPDA] = getVaultPDA(publicKey, chipPubkey);

      const txSigResult = await executeTap(
        program,
        vaultPDA,
        vaultPDA,        // vault_ata placeholder (not used for SOL)
        targetPubkey,    // target_ata placeholder (not used for SOL)
        derivedPDA,      // sol_vault = the PDA that holds SOL
        targetPubkey,    // target_wallet
        payloadBytes,
        sigBytes,
        recoveryId,
        chipPubkey
      );

      setTxSig(txSigResult);
      setState("success");
      toast.success("Payment confirmed on Solana!");
      refreshVault();
    } catch (err: any) {
      console.error("execute_tap failed:", err);
      const msg = parseAnchorError(err);
      setErrorMsg(msg);
      setState("error");
      toast.error(msg);
    }
  };

  // If NFC data was received from URL params (Phantom deep link) but not connected yet,
  // show connect wallet screen
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
            {nfcPayloadHex
              ? "Connect your wallet to complete the NFC payment."
              : isMobileChromeFlow
              ? "Open this page in Phantom\u2019s browser to make tap payments. Use Chrome only for NFC scanning."
              : "Connect a Solana wallet to make tap payments."}
          </p>
          <WalletMultiButton />
          <MobileWalletHelper />
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

          {/* ── NFC done on mobile Chrome – redirecting to Phantom ── */}
          {state === "nfc_done_mobile" && (
            <motion.div
              key="nfc_done_mobile"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="glass-card p-12 text-center"
            >
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-bold mb-2">NFC Signed!</h2>
              <p className="text-muted-foreground text-sm mb-4">
                Opening Phantom to complete the payment...
              </p>
              <Loader2 className="w-6 h-6 text-primary mx-auto animate-spin" />
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
