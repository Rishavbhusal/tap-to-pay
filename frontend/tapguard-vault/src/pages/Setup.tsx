import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { BN } from "@coral-xyz/anchor";
import { Nfc, Sliders, Check, ArrowRight, ArrowLeft, Loader2, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { solToUsd, truncateAddress, solToLamports } from "@/lib/constants";
import { initVault } from "@/lib/program";
import { useProgram } from "@/hooks/useProgram";
import { useSolana } from "@/hooks/useSolana";
import { toast } from "sonner";
import { useHaloChip } from "../hooks/useHaloChip";

const steps = ["Scan NFC", "Set Limit", "Confirm"];

export default function Setup() {
  const [step, setStep] = useState(0);
  const [chipPubkey, setChipPubkey] = useState("");
  const [dailyLimit, setDailyLimit] = useState(5);
  const [creating, setCreating] = useState(false);
  const [success, setSuccess] = useState(false);
  const { connected, publicKey } = useWallet();
  const navigate = useNavigate();
  const program = useProgram();
  const { refreshVault } = useSolana();

  const { getChipPublicKey, isLoading: haloLoading, error: haloError } = useHaloChip();

  const handleNfcScan = async () => {
    toast.info("Hold your HaLo NFC chip near your phone...");
    try {
      const result = await getChipPublicKey();
      if (result && result.address) {
        setChipPubkey(result.address.replace(/^0x/, ""));
        toast.success("Chip public key detected!");
      } else {
        toast.error("Failed to read chip public key");
      }
    } catch (e: any) {
      toast.error("NFC scan failed: " + (e?.message || e));
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
      const dailyLimitLamports = new BN(solToLamports(dailyLimit));
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
            <button onClick={handleNfcScan} className="mx-auto mb-6 block">
              <div className="relative w-24 h-24 mx-auto">
                <div className="absolute inset-0 rounded-full bg-primary/10 pulse-nfc" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Nfc className="w-10 h-10 text-primary" />
                </div>
              </div>
            </button>
            <h2 className="text-2xl font-bold mb-2">Scan NFC Chip</h2>
            <p className="text-muted-foreground text-sm mb-6">
              Hold your NFC wristband or card near your device to read its public key.
            </p>

            <div className="text-left mb-6">
              <label className="text-xs text-muted-foreground mb-1.5 block">
                Or paste chip public key manually (hex, 128 chars)
              </label>
              <Input
                placeholder="0x..."
                value={chipPubkey}
                onChange={(e) => setChipPubkey(e.target.value)}
                className="font-mono text-xs bg-muted border-border"
              />
            </div>

            <Button
              onClick={() => {
                if (!chipPubkey) {
                  setChipPubkey("a1b2c3d4e5f6".repeat(10) + "abcd1234");
                  toast.info("Using demo chip key");
                }
                setStep(1);
              }}
              className="w-full btn-glow bg-primary text-primary-foreground rounded-xl"
            >
              Continue
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </motion.div>
        )}

        {/* Step 2: Set Limit */}
        {step === 1 && (
          <motion.div
            key="step-1"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="glass-card p-8"
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Sliders className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Daily Spending Limit</h2>
                <p className="text-muted-foreground text-xs">Max SOL that can be spent per day via NFC taps</p>
              </div>
            </div>

            <div className="text-center mb-8">
              <div className="text-5xl font-bold gradient-text mb-1">{dailyLimit.toFixed(1)} SOL</div>
              <div className="text-muted-foreground text-sm">≈ ${solToUsd(dailyLimit)}</div>
            </div>

            <Slider
              value={[dailyLimit]}
              onValueChange={([v]) => setDailyLimit(v)}
              min={0.1}
              max={100}
              step={0.1}
              className="mb-8"
            />

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(0)} className="flex-1 rounded-xl border-border">
                <ArrowLeft className="mr-2 w-4 h-4" />
                Back
              </Button>
              <Button onClick={() => setStep(2)} className="flex-1 btn-glow bg-primary text-primary-foreground rounded-xl">
                Continue
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </div>
          </motion.div>
        )}

        {/* Step 3: Confirm */}
        {step === 2 && !success && (
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
                <span className="font-semibold">{dailyLimit.toFixed(1)} SOL <span className="text-muted-foreground">(${solToUsd(dailyLimit)})</span></span>
              </div>
              <div className="flex justify-between items-center py-3">
                <span className="text-muted-foreground text-sm">Network Fee</span>
                <span className="text-muted-foreground text-sm">~0.003 SOL</span>
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1 rounded-xl border-border">
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
