import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import MobileWalletHelper from "@/components/MobileWalletHelper";
import {
  Zap, CheckCircle, Loader2, Smartphone,
  XCircle, ExternalLink, Wallet, Radio,
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
  serializeTapPayload, hashPayload, hexToBytes, bytesToHex,
  type TapPayloadFields,
} from "@/lib/payload";
import { toast } from "sonner";

type TapState = "idle" | "waiting" | "verifying" | "success" | "error" | "nfc_done_mobile" | "passive_processing";

function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
}
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
  const [passiveInfo, setPassiveInfo] = useState("");

  const { connected, publicKey } = useWallet();
  const { vault, vaultPDA, refreshVault, network } = useSolana();
  const program = useProgram();
  const [searchParams] = useSearchParams();

  const isMobile = isMobileDevice();
  const inPhantom = isPhantomBrowser();
  const isMobileChromeFlow = isMobile && !inPhantom;

  // ── Passive NFC URL detection ──
  // When HaLo chip is tapped (any device), the NDEF URL opens:
  //   https://our-domain.com/tap?av=...&pk1=04...&sig1=...&ctr=000042
  // We detect pk1 + ctr and call the relay for a gasless transaction.
  const pk1Param = searchParams.get("pk1");
  const ctrParam = searchParams.get("ctr");
  const isPassiveMode = !!(pk1Param && ctrParam);

  // Auto-process passive tap
  useEffect(() => {
    if (!isPassiveMode) return;
    processPassiveTap();
  }, [isPassiveMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const processPassiveTap = async () => {
    setState("passive_processing");
    setPassiveInfo(`Chip detected. Submitting payment via relay...`);

    try {
      // Parse counter — can be hex (e.g. "00002a") or decimal
      let counterNum: number;
      if (ctrParam!.match(/^[0-9a-fA-F]+$/) && ctrParam!.length >= 4) {
        counterNum = parseInt(ctrParam!, 16);
      } else {
        counterNum = parseInt(ctrParam!, 10);
      }

      if (isNaN(counterNum) || counterNum <= 0) {
        throw new Error("Invalid counter value: " + ctrParam);
      }

      setPassiveInfo(`Counter: ${counterNum}. Sending to relay...`);

      const res = await fetch("/api/relay-tap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pk1: pk1Param,
          counter: counterNum,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Relay returned ${res.status}`);
      }

      setTxSig(data.txSignature);
      setState("success");
      toast.success("Payment confirmed on Solana!");
    } catch (err: any) {
      console.error("Passive tap failed:", err);
      const msg = err?.message || "Transaction failed";
      setErrorMsg(msg);
      setState("error");
      toast.error(msg);
    }
  };

  // ── Active NFC flow state (Android wallet-signed) ──
  const [nfcPayloadHex, setNfcPayloadHex] = useState("");
  const [nfcSigHex, setNfcSigHex] = useState("");
  const [nfcRecoveryId, setNfcRecoveryId] = useState(0);

  // Deep link from Chrome with NFC signature data
  useEffect(() => {
    if (isPassiveMode) return; // passive mode takes priority
    const sig = searchParams.get("sig");
    const payload = searchParams.get("payload");
    const rv = searchParams.get("rv");
    const amt = searchParams.get("amount");
    const tgt = searchParams.get("target");
    if (sig && payload && rv !== null && amt && tgt) {
      setNfcSigHex(sig);
      setNfcPayloadHex(payload);
      setNfcRecoveryId(parseInt(rv, 10));
      setAmount(amt);
      setTargetAddress(tgt);
      setState("verifying");
    }
  }, [searchParams, isPassiveMode]);

  // Auto-submit active tx when data is ready
  const submitNfcTx = useCallback(async () => {
    if (!program || !publicKey || !vault || !vaultPDA) {
      toast.error("Wallet not connected or vault not found");
      return;
    }
    try {
      let targetPubkey: PublicKey;
      try { targetPubkey = new PublicKey(targetAddress.trim()); } catch { toast.error("Invalid target wallet"); return; }
      const payloadBytes = hexToBytes(nfcPayloadHex);
      const sigBytes = [...hexToBytes(nfcSigHex)];
      const chipPubkey = vault.chipPubkey;
      const [derivedPDA] = getVaultPDA(publicKey, chipPubkey);
      const txSigResult = await executeTap(program, vaultPDA, vaultPDA, targetPubkey, derivedPDA, targetPubkey, payloadBytes, sigBytes, nfcRecoveryId, chipPubkey);
      setTxSig(txSigResult);
      setState("success");
      toast.success("Payment confirmed on Solana!");
      refreshVault();
    } catch (err: any) {
      console.error("execute_tap failed:", err);
      setErrorMsg(err?.message || "Transaction failed");
      setState("error");
      toast.error(err?.message || "Transaction failed");
    }
  }, [program, publicKey, vault, vaultPDA, targetAddress, nfcPayloadHex, nfcSigHex, nfcRecoveryId, refreshVault]);

  useEffect(() => {
    if (state === "verifying" && nfcPayloadHex && nfcSigHex && connected && vault) submitNfcTx();
  }, [state, nfcPayloadHex, nfcSigHex, connected, vault, submitNfcTx]);

  useEffect(() => { refreshVault(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { setState("idle"); setTxSig(""); setErrorMsg(""); setPassiveInfo(""); };

  // ── Active tap start ──
  const startTap = async () => {
    if (!program || !publicKey || !vault || !vaultPDA) { toast.error("Wallet/vault missing"); return; }
    let targetPubkey: PublicKey;
    try { targetPubkey = new PublicKey(targetAddress.trim()); } catch { toast.error("Invalid target"); return; }
    const amountFloat = parseFloat(amount);
    if (!amountFloat || amountFloat <= 0) { toast.error("Enter valid amount"); return; }
    const amountLamports = new BN(solToLamports(amountFloat));
    const nonce = vault.nonce;
    const nowSec = new BN(Math.floor(Date.now() / 1000));
    const payload: TapPayloadFields = {
      programId: PROGRAM_ID, ownerSol: vault.ownerSol, action: 1,
      mint: SystemProgram.programId, amount: amountLamports,
      target: targetPubkey, nonce, timestamp: nowSec,
    };
    const payloadBytes = serializeTapPayload(payload);
    const digestHex = hashPayload(payloadBytes);
    const hasWebNFC = (() => { try { return typeof (window as any).NDEFReader === "function"; } catch { return false; } })();
    if (!hasWebNFC) { setErrorMsg("Web NFC not supported. Use passive NFC tap on this device."); setState("error"); return; }

    setState("waiting");
    toast.info("Hold your NFC chip near your phone...");
    try {
      const { execHaloCmdWeb } = await import("@arx-research/libhalo/api/web");
      const haloResult = await execHaloCmdWeb({ name: "sign", keyNo: 1, digest: digestHex });
      if (!haloResult?.signature?.raw) throw new Error("No signature from chip");
      const { r, s, v } = haloResult.signature.raw;
      const rBytes = hexToBytes(r);
      const sBytes = hexToBytes(s);
      const sigBytes: number[] = [...rBytes, ...sBytes];
      const recoveryId = v - 27;

      if (isMobileChromeFlow) {
        const sigHex = bytesToHex(new Uint8Array(sigBytes));
        const payloadHex = bytesToHex(new Uint8Array(payloadBytes));
        const tapUrl = `${window.location.origin}/tap?sig=${sigHex}&payload=${payloadHex}&rv=${recoveryId}&amount=${amount}&target=${targetAddress.trim()}`;
        const phantomUrl = `https://phantom.app/ul/browse/${encodeURIComponent(tapUrl)}`;
        setState("nfc_done_mobile");
        toast.success("NFC signed! Opening Phantom...");
        setTimeout(() => { window.location.href = phantomUrl; }, 1500);
        return;
      }

      setState("verifying");
      const chipPubkey = vault.chipPubkey;
      const [derivedPDA] = getVaultPDA(publicKey!, chipPubkey);
      const txSigResult = await executeTap(program, vaultPDA, vaultPDA, targetPubkey, derivedPDA, targetPubkey, payloadBytes, sigBytes, recoveryId, chipPubkey);
      setTxSig(txSigResult);
      setState("success");
      toast.success("Payment confirmed on Solana!");
      refreshVault();
    } catch (err: any) {
      console.error("execute_tap failed:", err);
      setErrorMsg(err?.message || "Transaction failed");
      setState("error");
      toast.error(err?.message || "Transaction failed");
    }
  };

  // ── Passive mode UI (no wallet needed) ──
  if (isPassiveMode) {
    return (
      <div className="container py-10 max-w-md">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold mb-1">NFC Tap Payment</h1>
            <p className="text-muted-foreground text-sm">Gasless — powered by relay</p>
          </div>

          <AnimatePresence mode="wait">
            {state === "passive_processing" && (
              <motion.div key="passive" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card p-12 text-center">
                <div className="relative w-24 h-24 mx-auto mb-6">
                  {[0, 1, 2].map((i) => (
                    <motion.div key={i} className="absolute inset-0 rounded-full border border-primary/40"
                      animate={{ scale: [0.8, 2], opacity: [0.6, 0] }}
                      transition={{ duration: 2, repeat: Infinity, delay: i * 0.5 }} />
                  ))}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Radio className="w-10 h-10 text-primary" />
                  </div>
                </div>
                <h2 className="text-xl font-bold mb-2">Processing Payment...</h2>
                <p className="text-muted-foreground text-sm mb-2">{passiveInfo}</p>
                <Loader2 className="w-6 h-6 text-primary mx-auto animate-spin" />
              </motion.div>
            )}

            {state === "success" && (
              <motion.div key="success" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="glass-card p-12 text-center">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300 }}>
                  <CheckCircle className="w-20 h-20 text-success mx-auto mb-4" style={{ filter: "drop-shadow(0 0 20px hsl(var(--success) / 0.5))" }} />
                </motion.div>
                <h2 className="text-2xl font-bold mb-1 text-success">Payment Confirmed!</h2>
                <p className="text-muted-foreground text-sm mb-4">Gasless NFC tap payment completed.</p>
                {txSig && (
                  <a href={`${SOLSCAN_BASE}/${txSig}?cluster=${network}`} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline mb-4">
                    View on Solscan <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <div className="mt-4">
                  <Button onClick={reset} className="rounded-xl bg-primary text-primary-foreground">Tap Again</Button>
                </div>
              </motion.div>
            )}

            {state === "error" && (
              <motion.div key="error" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="glass-card p-12 text-center">
                <XCircle className="w-16 h-16 text-destructive mx-auto mb-4" />
                <h2 className="text-xl font-bold mb-2 text-destructive">Payment Failed</h2>
                <p className="text-sm text-muted-foreground mb-6 max-w-xs mx-auto break-words">{errorMsg}</p>
                <Button onClick={reset} className="rounded-xl bg-primary text-primary-foreground">Try Again</Button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    );
  }

  // ── Active mode: need wallet ──
  if (!connected) {
    return (
      <motion.div className="fixed inset-0 z-40 bg-background/90 backdrop-blur-xl flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <motion.div className="glass-card p-10 text-center max-w-sm mx-4" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1 }}>
          <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-6">
            <Wallet className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Connect Your Wallet</h2>
          <p className="text-muted-foreground text-sm mb-6">
            {nfcPayloadHex ? "Connect wallet to complete the NFC payment." :
             isMobileChromeFlow ? "Open in Phantom's browser for wallet signing." :
             "Connect a Solana wallet to make tap payments."}
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
          <p className="text-muted-foreground text-sm mb-6">Create a vault first from the Setup page.</p>
          <Button asChild className="rounded-xl bg-primary text-primary-foreground"><a href="/setup">Set Up Vault</a></Button>
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
          {state === "idle" && (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card p-8 space-y-5">
              <div>
                <label className="text-sm text-muted-foreground mb-1.5 block">Recipient Wallet Address</label>
                <Input placeholder="Enter Solana address..." value={targetAddress} onChange={(e) => setTargetAddress(e.target.value)} className="font-mono text-xs bg-muted border-border" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1.5 block">Amount (SOL)</label>
                <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-3xl font-bold text-center h-16 bg-muted border-border" step="0.01" min="0.001" />
                <p className="text-center text-sm text-muted-foreground mt-1">≈ ${solToUsd(parseFloat(amount) || 0)}</p>
              </div>
              {vault.frozen && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-sm text-destructive text-center">Vault is frozen. Unfreeze from Settings.</div>
              )}
              <Button onClick={startTap} className="w-full btn-glow bg-primary text-primary-foreground rounded-xl h-14 text-base"
                disabled={!amount || parseFloat(amount) <= 0 || !targetAddress.trim() || vault.frozen}>
                <Smartphone className="mr-2 w-5 h-5" /> Sign with NFC & Pay
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Active mode — requires Android Chrome with Web NFC.<br />
                For iPhone, use passive NFC tap (opens automatically).
              </p>
            </motion.div>
          )}

          {state === "waiting" && (
            <motion.div key="waiting" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="glass-card p-12 text-center">
              <div className="relative w-28 h-28 mx-auto mb-6">
                {[0, 1, 2].map((i) => (
                  <motion.div key={i} className="absolute inset-0 rounded-full border border-primary/40"
                    animate={{ scale: [0.8, 2], opacity: [0.6, 0] }}
                    transition={{ duration: 2, repeat: Infinity, delay: i * 0.5 }} />
                ))}
                <div className="absolute inset-0 flex items-center justify-center"><Zap className="w-12 h-12 text-primary pulse-nfc" /></div>
              </div>
              <h2 className="text-xl font-bold mb-1">Tap your NFC chip</h2>
              <p className="text-muted-foreground text-sm mb-2">{amount} SOL → {targetAddress.slice(0, 6)}...{targetAddress.slice(-4)}</p>
              <Button variant="outline" onClick={reset} className="mt-6 rounded-xl border-border">Cancel</Button>
            </motion.div>
          )}

          {state === "verifying" && (
            <motion.div key="verifying" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card p-12 text-center">
              <Loader2 className="w-12 h-12 text-primary mx-auto mb-4 animate-spin" />
              <h2 className="text-xl font-bold mb-1">Verifying on-chain...</h2>
              <p className="text-muted-foreground text-sm">Confirming transaction on Solana</p>
            </motion.div>
          )}

          {state === "success" && (
            <motion.div key="success" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="glass-card p-12 text-center">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300 }}>
                <CheckCircle className="w-20 h-20 text-success mx-auto mb-4" style={{ filter: "drop-shadow(0 0 20px hsl(var(--success) / 0.5))" }} />
              </motion.div>
              <h2 className="text-2xl font-bold mb-1 text-success">Payment Confirmed</h2>
              <p className="text-3xl font-bold mb-1">{amount} SOL</p>
              <p className="text-muted-foreground text-sm mb-2">${solToUsd(parseFloat(amount))}</p>
              {txSig && (
                <a href={`${SOLSCAN_BASE}/${txSig}?cluster=${network}`} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline mb-4">
                  View on Solscan <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <div className="mt-4"><Button onClick={reset} className="rounded-xl bg-primary text-primary-foreground">New Payment</Button></div>
            </motion.div>
          )}

          {state === "nfc_done_mobile" && (
            <motion.div key="nfc_done_mobile" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="glass-card p-12 text-center">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-bold mb-2">NFC Signed!</h2>
              <p className="text-muted-foreground text-sm mb-4">Opening Phantom to complete payment...</p>
              <Loader2 className="w-6 h-6 text-primary mx-auto animate-spin" />
            </motion.div>
          )}

          {state === "error" && (
            <motion.div key="error" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="glass-card p-12 text-center">
              <XCircle className="w-16 h-16 text-destructive mx-auto mb-4" />
              <h2 className="text-xl font-bold mb-2 text-destructive">Payment Failed</h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-xs mx-auto break-words">{errorMsg}</p>
              <Button onClick={reset} className="rounded-xl bg-primary text-primary-foreground">Try Again</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
