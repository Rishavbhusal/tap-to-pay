import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { BN } from "@coral-xyz/anchor";
import { Nfc, Check, ArrowRight, ArrowLeft, Loader2, PartyPopper, Link2, Smartphone, ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { truncateAddress } from "@/lib/constants";
import { initVault } from "@/lib/program";
import { useProgram } from "@/hooks/useProgram";
import { useSolana } from "@/hooks/useSolana";
import { toast } from "sonner";
import { useHaloChip } from "../hooks/useHaloChip";

const steps = ["Scan NFC", "Confirm"];

export default function Setup() {
  const [step, setStep] = useState(0);
  const [chipPubkey, setChipPubkey] = useState("");
  const [chipScanned, setChipScanned] = useState(false);
  const [pastedUrl, setPastedUrl] = useState("");
  const [scanMode, setScanMode] = useState<"nfc" | "url">("url"); // default to URL mode (works on iOS)
  const [creating, setCreating] = useState(false);
  const [success, setSuccess] = useState(false);
  const { connected, publicKey } = useWallet();
  const navigate = useNavigate();
  const program = useProgram();
  const { refreshVault } = useSolana();

  const { getChipPublicKey, getChipFromUrl, isLoading: haloLoading, error: haloError } = useHaloChip();

  const handleNfcScan = async () => {
    toast.info("Hold your NFC chip near your phone...");
    try {
      const result = await getChipPublicKey();
      if (result && result.address) {
        setChipPubkey(result.address.replace(/^0x/, ""));
        setChipScanned(true);
        toast.success("Chip public key detected!");
      } else {
        setChipPubkey("");
        setChipScanned(false);
        toast.error("Failed to read chip public key");
      }
    } catch (e: any) {
      setChipPubkey("");
      setChipScanned(false);
      toast.error("NFC scan failed. Try pasting the URL instead.");
      setScanMode("url");
    }
  };

  const handleUrlPaste = (url?: string) => {
    const urlToParse = url || pastedUrl;
    if (!urlToParse.trim()) {
      toast.error("Please paste the URL from your NFC chip redirect");
      return;
    }
    const result = getChipFromUrl(urlToParse);
    if (result && result.address) {
      setChipPubkey(result.address);
      setChipScanned(true);
      toast.success("Chip public key extracted from URL!");
    } else {
      toast.error("Could not extract public key from URL. Make sure you copied the full URL from nfc.ethglobal.com");
    }
  };

  const handleClipboardPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setPastedUrl(text);
        // Auto-parse immediately
        handleUrlPaste(text);
      } else {
        toast.error("Clipboard is empty");
      }
    } catch {
      toast.error("Cannot read clipboard. Please paste manually into the field below.");
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setPastedUrl(val);
    // Auto-parse if it looks like a URL with pk1
    if (val.includes("pk1=") || val.includes("static=")) {
      const result = getChipFromUrl(val);
      if (result && result.address) {
        setChipPubkey(result.address);
        setChipScanned(true);
        toast.success("Chip public key extracted!");
      }
    }
  };

  const handleCreate = async () => {
    if (!program || !publicKey) {
      toast.error("Wallet not connected");
      return;
    }

    const hexClean = chipPubkey.replace(/^0x/, "");
    if (hexClean.length !== 128) {
      toast.error("Chip public key must be 128 hex characters (64 bytes)");
      return;
    }
    const chipBytes: number[] = [];
    for (let i = 0; i < hexClean.length; i += 2) {
      chipBytes.push(parseInt(hexClean.substring(i, i + 2), 16));
    }

    setCreating(true);
    try {
      // Set daily limit to max value (no limit) for now
      const dailyLimitLamports = new BN("18446744073709551615");
      const { tx, registryPDA } = await initVault(program, publicKey, chipBytes, dailyLimitLamports);
      console.log("Vault created! Tx:", tx, "PDA:", registryPDA.toBase58());
      setSuccess(true);
      toast.success("Vault created successfully!");
      await refreshVault();
      setTimeout(() => navigate("/dashboard"), 3000);
    } catch (err: any) {
      console.error("Failed to create vault:", err);
      toast.error(err?.message || "Failed to create vault");
    } finally {
      setCreating(false);
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
            <Nfc className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Connect Your Wallet</h2>
          <p className="text-muted-foreground text-sm mb-6">
            Connect a Solana wallet to set up your vault.
          </p>
          <WalletMultiButton />
        </motion.div>
      </motion.div>
    );
  }

  return (
    <div className="container py-10 max-w-lg">
      {/* Progress bar */}
      <div className="flex items-center gap-2 mb-10">
        {steps.map((s, i) => (
          <div key={s} className="flex-1 flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                i <= step
                  ? "bg-primary text-primary-foreground shadow-glow-sm"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {i < step ? <Check className="w-4 h-4" /> : i + 1}
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 rounded ${i < step ? "bg-primary" : "bg-muted"}`} />
            )}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* Step 1: Scan NFC */}
        {step === 0 && (
          <motion.div
            key="step-0"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="glass-card p-8 text-center"
          >
            {/* Mode toggle */}
            <div className="flex gap-2 mb-6">
              <Button
                variant={scanMode === "url" ? "default" : "outline"}
                onClick={() => setScanMode("url")}
                className="flex-1 rounded-xl text-xs"
                size="sm"
              >
                <Link2 className="w-3 h-3 mr-1" />
                Paste URL (iOS)
              </Button>
              <Button
                variant={scanMode === "nfc" ? "default" : "outline"}
                onClick={() => setScanMode("nfc")}
                className="flex-1 rounded-xl text-xs"
                size="sm"
              >
                <Smartphone className="w-3 h-3 mr-1" />
                Web NFC (Android)
              </Button>
            </div>

            {scanMode === "nfc" ? (
              <>
                <button onClick={handleNfcScan} className="mx-auto mb-6 block" disabled={haloLoading}>
                  <div className="relative w-24 h-24 mx-auto">
                    <div className="absolute inset-0 rounded-full bg-primary/10 pulse-nfc" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      {haloLoading ? (
                        <Loader2 className="w-10 h-10 text-primary animate-spin" />
                      ) : (
                        <Nfc className="w-10 h-10 text-primary" />
                      )}
                    </div>
                  </div>
                </button>
                <h2 className="text-2xl font-bold mb-2">Scan NFC Chip</h2>
                <p className="text-muted-foreground text-sm mb-6">
                  Tap the NFC icon above, then hold your chip near your phone.
                  <br />
                  <span className="text-xs text-yellow-500">Only works on Android Chrome.</span>
                </p>
              </>
            ) : (
              <>
                <div className="relative w-24 h-24 mx-auto mb-6">
                  <div className="absolute inset-0 rounded-full bg-primary/10" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Link2 className="w-10 h-10 text-primary" />
                  </div>
                </div>
                <h2 className="text-2xl font-bold mb-2">Paste NFC URL</h2>
                <p className="text-muted-foreground text-sm mb-4">
                  1. Tap your NFC wristband — it opens <strong>nfc.ethglobal.com</strong><br />
                  2. <strong>Copy the full URL</strong> from the address bar (long-press → Select All → Copy)<br />
                  3. Come back here and tap the button below
                </p>

                {/* Big clipboard paste button */}
                <Button
                  onClick={handleClipboardPaste}
                  className="w-full h-14 rounded-xl mb-4 bg-primary text-primary-foreground text-base"
                >
                  <ClipboardPaste className="mr-2 w-5 h-5" />
                  Paste from Clipboard
                </Button>

                <div className="text-left mb-4">
                  <label className="text-xs text-muted-foreground mb-1.5 block">
                    Or paste the URL manually here
                  </label>
                  <textarea
                    placeholder="https://nfc.ethglobal.com/?av=A02.03...&pk1=04..."
                    value={pastedUrl}
                    onChange={handleTextareaChange}
                    rows={4}
                    className="w-full font-mono text-xs bg-muted border border-border rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>

                {!chipScanned && pastedUrl && (
                  <Button
                    onClick={() => handleUrlPaste()}
                    variant="outline"
                    className="w-full rounded-xl mb-4 border-primary/30 text-primary"
                  >
                    <Check className="mr-2 w-4 h-4" />
                    Extract Public Key
                  </Button>
                )}
              </>
            )}

            {/* Extracted key display */}
            {chipScanned && chipPubkey && (
              <div className="text-left mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                <label className="text-xs text-green-500 mb-1 block flex items-center gap-1">
                  <Check className="w-3 h-3" /> Chip Public Key Detected
                </label>
                <p className="font-mono text-xs text-green-400 break-all">
                  {truncateAddress(chipPubkey, 16)}
                </p>
              </div>
            )}

            <Button
              onClick={() => setStep(1)}
              className="w-full btn-glow bg-primary text-primary-foreground rounded-xl"
              disabled={!chipScanned || !chipPubkey}
            >
              Continue
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </motion.div>
        )}

        {/* Step 2: Confirm */}
        {step === 1 && !success && (
          <motion.div
            key="step-2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="glass-card p-8"
          >
            <h2 className="text-2xl font-bold mb-6">Confirm Vault Creation</h2>

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
                <ArrowLeft className="mr-2 w-4 h-4" />
                Back
              </Button>
              <Button onClick={handleCreate} disabled={creating} className="flex-1 btn-glow bg-primary text-primary-foreground rounded-xl">
                {creating ? (
                  <>
                    <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    Create Vault
                    <Check className="ml-2 w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        )}

        {/* Success */}
        {success && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card p-12 text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 300, delay: 0.2 }}
            >
              <PartyPopper className="w-16 h-16 text-primary mx-auto mb-4" />
            </motion.div>
            <h2 className="text-2xl font-bold mb-2 gradient-text">Vault Created!</h2>
            <p className="text-muted-foreground text-sm">Redirecting to dashboard...</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
