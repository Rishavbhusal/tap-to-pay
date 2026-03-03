import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import MobileWalletHelper from "@/components/MobileWalletHelper";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  Nfc, Check, ArrowRight, ArrowLeft, Loader2, PartyPopper,
  Link2, Smartphone, ClipboardPaste, AlertTriangle, ExternalLink,
  Settings2, Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { truncateAddress, solToLamports } from "@/lib/constants";
import { initVault, setTapConfig } from "@/lib/program";
import { useProgram } from "@/hooks/useProgram";
import { useSolana } from "@/hooks/useSolana";
import { toast } from "sonner";
import { useHaloChip } from "../hooks/useHaloChip";

const VAULT_CREATED_KEY = "tapvault_created";

const steps = ["Scan NFC", "Create Vault", "NDEF Config", "Tap Config"];

function isWebNFCSupported(): boolean {
  try { return typeof (window as any).NDEFReader === "function"; } catch { return false; }
}
function isPhantomBrowser(): boolean {
  const ua = navigator.userAgent || "";
  return /Phantom/i.test(ua) || !!(window as any).solana?.isPhantom;
}
function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
}

export default function Setup() {
  const [step, setStep] = useState(0);
  const [chipPubkey, setChipPubkey] = useState("");
  const [chipScanned, setChipScanned] = useState(false);
  const [pastedUrl, setPastedUrl] = useState("");
  const [scanMode, setScanMode] = useState<"nfc" | "url">("url");
  const [creating, setCreating] = useState(false);
  const [success, setSuccess] = useState(false);

  // NDEF config
  const [ndefConfiguring, setNdefConfiguring] = useState(false);
  const [ndefConfigured, setNdefConfigured] = useState(false);

  // Tap config
  const [tapTarget, setTapTarget] = useState("");
  const [tapAmountSol, setTapAmountSol] = useState("0.01");
  const [relayPubkey, setRelayPubkey] = useState("");
  const [tapConfiguring, setTapConfiguring] = useState(false);

  const webNFCAvailable = isWebNFCSupported();
  const inPhantom = isPhantomBrowser();
  const isMobile = isMobileDevice();
  const isMobileChromeFlow = isMobile && !inPhantom;
  const { connected, publicKey } = useWallet();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const program = useProgram();
  const { vault, vaultLoading, refreshVault, vaultPDA } = useSolana();

  // Fetch relay pubkey on mount
  useEffect(() => {
    fetch("/api/relay-info")
      .then((r) => r.json())
      .then((d) => { if (d.relayPubkey) setRelayPubkey(d.relayPubkey); })
      .catch(() => { /* relay not running yet */ });
  }, []);

  // If vault exists, skip to tap config or redirect to dashboard
  useEffect(() => {
    if (vault && vaultPDA) {
      sessionStorage.removeItem(VAULT_CREATED_KEY);
      const defaultPk = new PublicKey("11111111111111111111111111111111");
      const isConfigured =
        vault.relayAuthority && !vault.relayAuthority.equals(defaultPk) &&
        vault.tapTarget && !vault.tapTarget.equals(defaultPk) &&
        vault.tapAmount && vault.tapAmount.toNumber() > 0;
      if (isConfigured) {
        toast.success("Vault fully configured!");
        navigate("/dashboard", { replace: true });
      } else if (step < 2) {
        setStep(2);
      }
    }
  }, [vault, vaultPDA, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // sessionStorage flag for surviving Phantom reloads
  useEffect(() => {
    if (sessionStorage.getItem(VAULT_CREATED_KEY) === "1") {
      setSuccess(true);
      refreshVault();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep link from Chrome with ?chip=
  useEffect(() => {
    const chipParam = searchParams.get("chip");
    if (chipParam && /^[0-9a-fA-F]{128}$/.test(chipParam)) {
      setChipPubkey(chipParam);
      setChipScanned(true);
      setStep(1);
      toast.success("Chip key loaded from NFC scan!");
      const url = new URL(window.location.href);
      url.searchParams.delete("chip");
      window.history.replaceState({}, "", url.pathname);
    }
  }, [searchParams]);

  const { getChipPublicKey, getChipFromUrl, isLoading: haloLoading } = useHaloChip();

  // ── NFC scan handler ──
  const handleNfcScan = async () => {
    if (!webNFCAvailable) {
      toast.error("Web NFC not supported. Use the Paste URL tab.");
      setScanMode("url");
      return;
    }
    toast.info("Hold your NFC chip near your phone...");
    try {
      const result = await getChipPublicKey();
      if (result?.address) {
        setChipPubkey(result.address.replace(/^0x/, ""));
        setChipScanned(true);
        toast.success("Chip public key detected!");
      } else {
        toast.error("Failed to read chip public key");
      }
    } catch (e: any) {
      console.error("NFC scan error:", e);
      toast.error("NFC scan failed: " + (e?.message || "Unknown error"));
      setScanMode("url");
    }
  };

  const handleUrlPaste = (url?: string) => {
    const u = url || pastedUrl;
    if (!u.trim()) { toast.error("Paste the URL from your NFC chip redirect"); return; }
    const result = getChipFromUrl(u);
    if (result?.address) {
      setChipPubkey(result.address);
      setChipScanned(true);
      toast.success("Chip public key extracted from URL!");
    } else {
      toast.error("Could not extract public key from URL.");
    }
  };

  const handleClipboardPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { setPastedUrl(text); handleUrlPaste(text); }
      else toast.error("Clipboard is empty");
    } catch { toast.error("Cannot read clipboard. Paste manually."); }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setPastedUrl(val);
    if (val.includes("pk1=") || val.includes("static=")) {
      const result = getChipFromUrl(val);
      if (result?.address) {
        setChipPubkey(result.address);
        setChipScanned(true);
        toast.success("Chip public key extracted!");
      }
    }
  };

  // ── Create vault handler ──
  const handleCreate = async () => {
    if (!program || !publicKey) { toast.error("Wallet not connected"); return; }
    const hexClean = chipPubkey.replace(/^0x/, "");
    if (hexClean.length !== 128) { toast.error("Chip key must be 128 hex chars"); return; }
    const chipBytes: number[] = [];
    for (let i = 0; i < hexClean.length; i += 2)
      chipBytes.push(parseInt(hexClean.substring(i, i + 2), 16));

    setCreating(true);
    try {
      sessionStorage.setItem(VAULT_CREATED_KEY, "1");
      const dailyLimitLamports = new BN("18446744073709551615");
      const { sig, registryPDA } = await initVault(program, publicKey, chipBytes, dailyLimitLamports);
      console.log("Vault created! Tx:", sig, "PDA:", registryPDA.toBase58());
      toast.success("Vault created! Now configure your chip for passive taps.");
      await refreshVault();
      setStep(2);
    } catch (err: any) {
      sessionStorage.removeItem(VAULT_CREATED_KEY);
      console.error("Failed to create vault:", err);
      toast.error(err?.message || "Failed to create vault");
    } finally {
      setCreating(false);
    }
  };

  // ── NDEF config handler ──
  const handleNdefConfig = async () => {
    if (!webNFCAvailable) {
      toast.error("NDEF config requires Android Chrome. Skipping.");
      setNdefConfigured(true);
      setStep(3);
      return;
    }
    setNdefConfiguring(true);
    try {
      const { execHaloCmdWeb } = await import("@arx-research/libhalo/api/web");
      const ndefPrefix = window.location.origin + "/tap";
      toast.info("Hold your NFC chip near your phone to configure NDEF URL...");
      await execHaloCmdWeb({
        name: "cfg_ndef",
        flagUseText: false,
        flagHidePk1: false,
        flagHidePk2: true,
        flagShowPk1Attest: false,
        flagShowPk2Attest: false,
        flagShowLatch1Sig: false,
        flagShowLatch2Sig: false,
        flagShowCounterSig: true,
        ndef_prefix: ndefPrefix,
      } as any);
      setNdefConfigured(true);
      toast.success(`NDEF URL set to: ${ndefPrefix}`);
      setStep(3);
    } catch (err: any) {
      console.error("NDEF config error:", err);
      toast.error("NDEF config failed: " + (err?.message || "Unknown error"));
    } finally {
      setNdefConfiguring(false);
    }
  };

  // ── Tap config handler ──
  const handleTapConfig = async () => {
    if (!program || !publicKey || !vaultPDA) { toast.error("Wallet not connected or vault not found"); return; }
    let targetPk: PublicKey;
    try { targetPk = new PublicKey(tapTarget.trim()); } catch { toast.error("Invalid target wallet"); return; }
    const amtFloat = parseFloat(tapAmountSol);
    if (!amtFloat || amtFloat <= 0) { toast.error("Enter a valid SOL amount"); return; }
    let relayPk: PublicKey;
    try { relayPk = new PublicKey(relayPubkey.trim()); } catch { toast.error("Invalid relay pubkey"); return; }

    setTapConfiguring(true);
    try {
      const amountLamports = new BN(solToLamports(amtFloat));
      const sig = await setTapConfig(program, vaultPDA, publicKey, targetPk, amountLamports, relayPk);
      console.log("Tap config set! Tx:", sig);
      toast.success("Tap configuration saved on-chain!");
      await refreshVault();
      setSuccess(true);
      setTimeout(() => navigate("/dashboard", { replace: true }), 2000);
    } catch (err: any) {
      console.error("set_tap_config failed:", err);
      toast.error(err?.message || "Failed to set tap config");
    } finally {
      setTapConfiguring(false);
    }
  };

  // ── Loading gate ──
  const justCreated = sessionStorage.getItem(VAULT_CREATED_KEY) === "1";
  if (!success && (vaultLoading || justCreated)) {
    return (
      <div className="container py-10 max-w-lg flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
        <p className="text-muted-foreground text-sm">
          {justCreated ? "Vault created! Loading..." : "Checking vault status..."}
        </p>
      </div>
    );
  }

  // ── Wallet gate ──
  if (!connected && !isMobileChromeFlow) {
    return (
      <motion.div className="fixed inset-0 z-40 bg-background/90 backdrop-blur-xl flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <motion.div className="glass-card p-10 text-center max-w-sm mx-4" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1 }}>
          <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-6">
            <Nfc className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Connect Your Wallet</h2>
          <p className="text-muted-foreground text-sm mb-6">Connect a Solana wallet to set up your vault.</p>
          <WalletMultiButton />
          <MobileWalletHelper />
        </motion.div>
      </motion.div>
    );
  }

  // ──────────────── RENDER ────────────────
  return (
    <div className="container py-10 max-w-lg">
      {/* Progress bar */}
      <div className="flex items-center gap-1 mb-10">
        {steps.map((s, i) => (
          <div key={s} className="flex-1 flex items-center gap-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${i <= step ? "bg-primary text-primary-foreground shadow-glow-sm" : "bg-muted text-muted-foreground"}`}>
              {i < step ? <Check className="w-3 h-3" /> : i + 1}
            </div>
            {i < steps.length - 1 && <div className={`flex-1 h-0.5 rounded ${i < step ? "bg-primary" : "bg-muted"}`} />}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ─── Step 0: Scan NFC ─── */}
        {step === 0 && (
          <motion.div key="step-0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="glass-card p-8 text-center">
            {/* Mode toggle */}
            <div className="flex gap-2 mb-6">
              <Button variant={scanMode === "url" ? "default" : "outline"} onClick={() => setScanMode("url")} className="flex-1 rounded-xl text-xs" size="sm">
                <Link2 className="w-3 h-3 mr-1" /> Paste URL (any device)
              </Button>
              <Button variant={scanMode === "nfc" ? "default" : "outline"} onClick={() => setScanMode("nfc")} className="flex-1 rounded-xl text-xs" size="sm">
                <Smartphone className="w-3 h-3 mr-1" /> Web NFC (Android)
              </Button>
            </div>

            {scanMode === "nfc" ? (
              <>
                {!webNFCAvailable && (
                  <div className="mb-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-left">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
                      <p className="text-xs text-yellow-400">
                        {inPhantom ? "Web NFC is not available in Phantom. Switch to the Paste URL tab." : "Web NFC is not supported. Use Chrome on Android, or Paste URL."}
                      </p>
                    </div>
                  </div>
                )}
                <button onClick={handleNfcScan} className="mx-auto mb-6 block" disabled={haloLoading || !webNFCAvailable}>
                  <div className={`relative w-24 h-24 mx-auto ${!webNFCAvailable ? "opacity-40" : ""}`}>
                    <div className="absolute inset-0 rounded-full bg-primary/10 pulse-nfc" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      {haloLoading ? <Loader2 className="w-10 h-10 text-primary animate-spin" /> : <Nfc className="w-10 h-10 text-primary" />}
                    </div>
                  </div>
                </button>
                <h2 className="text-2xl font-bold mb-2">Scan NFC Chip</h2>
                <p className="text-muted-foreground text-sm mb-6">
                  {webNFCAvailable ? "Tap the NFC icon, then hold your chip near your phone." : <span className="text-yellow-500">Use the Paste URL tab instead.</span>}
                </p>
              </>
            ) : (
              <>
                <div className="relative w-24 h-24 mx-auto mb-6">
                  <div className="absolute inset-0 rounded-full bg-primary/10" />
                  <div className="absolute inset-0 flex items-center justify-center"><Link2 className="w-10 h-10 text-primary" /></div>
                </div>
                <h2 className="text-2xl font-bold mb-2">Paste NFC URL</h2>
                <p className="text-muted-foreground text-sm mb-4">
                  1. Tap your NFC wristband — it opens <strong>nfc.ethglobal.com</strong><br />
                  2. <strong>Copy the full URL</strong> from the address bar<br />
                  3. Tap the button below
                </p>
                <Button onClick={handleClipboardPaste} className="w-full h-14 rounded-xl mb-4 bg-primary text-primary-foreground text-base">
                  <ClipboardPaste className="mr-2 w-5 h-5" /> Paste from Clipboard
                </Button>
                <div className="text-left mb-4">
                  <label className="text-xs text-muted-foreground mb-1.5 block">Or paste the URL manually</label>
                  <textarea placeholder="https://nfc.ethglobal.com/?av=A02.03...&pk1=04..." value={pastedUrl} onChange={handleTextareaChange} rows={4}
                    className="w-full font-mono text-xs bg-muted border border-border rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary/50" />
                </div>
                {!chipScanned && pastedUrl && (
                  <Button onClick={() => handleUrlPaste()} variant="outline" className="w-full rounded-xl mb-4 border-primary/30 text-primary">
                    <Check className="mr-2 w-4 h-4" /> Extract Public Key
                  </Button>
                )}
              </>
            )}

            {chipScanned && chipPubkey && (
              <div className="text-left mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                <label className="text-xs text-green-500 mb-1 block flex items-center gap-1"><Check className="w-3 h-3" /> Chip Public Key Detected</label>
                <p className="font-mono text-xs text-green-400 break-all">{truncateAddress(chipPubkey, 16)}</p>
              </div>
            )}

            {chipScanned && chipPubkey && isMobileChromeFlow && !connected ? (
              <Button onClick={() => { const u = `${window.location.origin}/setup?chip=${chipPubkey}`; window.location.href = `https://phantom.app/ul/browse/${encodeURIComponent(u)}`; }}
                className="w-full rounded-xl bg-purple-600 hover:bg-purple-700 text-white">
                <ExternalLink className="mr-2 w-4 h-4" /> Open in Phantom to Create Vault
              </Button>
            ) : (
              <Button onClick={() => setStep(1)} className="w-full btn-glow bg-primary text-primary-foreground rounded-xl" disabled={!chipScanned || !chipPubkey}>
                Continue <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            )}
          </motion.div>
        )}

        {/* ─── Step 1: Create Vault ─── */}
        {step === 1 && !success && (
          <motion.div key="step-1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="glass-card p-8">
            <h2 className="text-2xl font-bold mb-6">Create On-Chain Vault</h2>
            <div className="space-y-4 mb-8">
              <div className="flex justify-between items-center py-3 border-b border-border/30">
                <span className="text-muted-foreground text-sm">Chip Public Key</span>
                <span className="font-mono text-xs">{truncateAddress(chipPubkey, 12)}</span>
              </div>
              <div className="flex justify-between items-center py-3 border-b border-border/30">
                <span className="text-muted-foreground text-sm">Daily Limit</span>
                <span className="font-semibold">Unlimited</span>
              </div>
              <div className="flex justify-between items-center py-3">
                <span className="text-muted-foreground text-sm">Network Fee</span>
                <span className="text-muted-foreground text-sm">~0.003 SOL</span>
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(0)} className="flex-1 rounded-xl border-border">
                <ArrowLeft className="mr-2 w-4 h-4" /> Back
              </Button>
              <Button onClick={handleCreate} disabled={creating} className="flex-1 btn-glow bg-primary text-primary-foreground rounded-xl">
                {creating ? (<><Loader2 className="mr-2 w-4 h-4 animate-spin" /> Creating...</>) : (<>Create Vault <Check className="ml-2 w-4 h-4" /></>)}
              </Button>
            </div>
          </motion.div>
        )}

        {/* ─── Step 2: Configure NDEF URL ─── */}
        {step === 2 && !success && (
          <motion.div key="step-2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="glass-card p-8 text-center">
            <div className="relative w-20 h-20 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full bg-primary/10" />
              <div className="absolute inset-0 flex items-center justify-center"><Radio className="w-10 h-10 text-primary" /></div>
            </div>
            <h2 className="text-2xl font-bold mb-2">Configure NFC Chip</h2>
            <p className="text-muted-foreground text-sm mb-2">
              Program your chip's NDEF URL so tapping it on <strong>any phone</strong> (iPhone or Android) opens your payment page.
            </p>
            <p className="text-xs text-muted-foreground mb-6">
              NDEF URL: <code className="text-primary">{window.location.origin}/tap</code>
            </p>
            {!webNFCAvailable && (
              <div className="mb-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-left">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-yellow-400">NDEF config requires Android Chrome. You can skip and configure later.</p>
                </div>
              </div>
            )}
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(3)} className="flex-1 rounded-xl border-border">Skip for Now</Button>
              <Button onClick={handleNdefConfig} disabled={ndefConfiguring} className="flex-1 btn-glow bg-primary text-primary-foreground rounded-xl">
                {ndefConfiguring ? (<><Loader2 className="mr-2 w-4 h-4 animate-spin" /> Hold Chip...</>) : ndefConfigured ? (<><Check className="mr-2 w-4 h-4" /> Configured!</>) : (<><Nfc className="mr-2 w-4 h-4" /> Configure NDEF</>)}
              </Button>
            </div>
          </motion.div>
        )}

        {/* ─── Step 3: Set Tap Config ─── */}
        {step === 3 && !success && (
          <motion.div key="step-3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="glass-card p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Settings2 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Tap Payment Config</h2>
                <p className="text-xs text-muted-foreground">Set where SOL goes when someone taps</p>
              </div>
            </div>
            <div className="space-y-4 mb-6">
              <div>
                <label className="text-sm text-muted-foreground mb-1.5 block">Target Wallet (receives SOL on each tap)</label>
                <Input placeholder="Solana wallet address..." value={tapTarget} onChange={(e) => setTapTarget(e.target.value)} className="font-mono text-xs bg-muted border-border" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1.5 block">Amount per Tap (SOL)</label>
                <Input type="number" value={tapAmountSol} onChange={(e) => setTapAmountSol(e.target.value)} className="text-xl font-bold text-center h-14 bg-muted border-border" step="0.001" min="0.001" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1.5 block">Relay Authority Pubkey</label>
                <Input placeholder="Relay server public key..." value={relayPubkey} onChange={(e) => setRelayPubkey(e.target.value)} className="font-mono text-xs bg-muted border-border" />
                <p className="text-xs text-muted-foreground mt-1">Auto-fetched from relay server. This key is authorized to submit tap transactions.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(2)} className="flex-1 rounded-xl border-border">
                <ArrowLeft className="mr-2 w-4 h-4" /> Back
              </Button>
              <Button onClick={handleTapConfig} disabled={tapConfiguring || !tapTarget.trim() || !tapAmountSol || !relayPubkey.trim()} className="flex-1 btn-glow bg-primary text-primary-foreground rounded-xl">
                {tapConfiguring ? (<><Loader2 className="mr-2 w-4 h-4 animate-spin" /> Saving...</>) : (<>Save Config <Check className="ml-2 w-4 h-4" /></>)}
              </Button>
            </div>
          </motion.div>
        )}

        {/* ─── Success ─── */}
        {success && (
          <motion.div key="success" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="glass-card p-12 text-center">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, delay: 0.2 }}>
              <PartyPopper className="w-16 h-16 text-primary mx-auto mb-4" />
            </motion.div>
            <h2 className="text-2xl font-bold mb-2 gradient-text">Setup Complete!</h2>
            <p className="text-muted-foreground text-sm mb-2">Your vault is ready for passive NFC taps.</p>
            <p className="text-xs text-muted-foreground">Redirecting to dashboard...</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
