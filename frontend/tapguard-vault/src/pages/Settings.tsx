import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { useNavigate } from "react-router-dom";
import { BN } from "@coral-xyz/anchor";
import { Shield, ShieldOff, Sliders, AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useSolana } from "@/hooks/useSolana";
import { useProgram } from "@/hooks/useProgram";
import { lamportsToSol, solToUsd, truncateAddress, solToLamports } from "@/lib/constants";
import { setLimit as setLimitIx, emergencyFreeze as emergencyFreezeIx, unfreezeVault as unfreezeIx } from "@/lib/program";
import { toast } from "sonner";

export default function Settings() {
  const { connected, publicKey } = useWallet();
  const { vault, vaultPDA, refreshVault } = useSolana();
  const program = useProgram();
  const navigate = useNavigate();
  const MAX_U64 = useMemo(() => new BN("18446744073709551615"), []);
  const currentLimitSol = useMemo(() => {
    if (!vault) return 5;
    try {
      if (vault.dailyLimit.gte(MAX_U64)) return 100;
      return lamportsToSol(vault.dailyLimit.toNumber());
    } catch {
      return 100;
    }
  }, [vault, MAX_U64]);
  const [newLimit, setNewLimit] = useState(currentLimitSol);
  const [updating, setUpdating] = useState(false);
  const [freezing, setFreezing] = useState(false);
  const [unfreezing, setUnfreezing] = useState(false);

  if (!connected) {
    navigate("/dashboard");
    return null;
  }

  if (!vault || !vaultPDA) return null;

  const handleUpdateLimit = async () => {
    if (!program || !publicKey || !vaultPDA) return;
    setUpdating(true);
    try {
      const newLimitLamports = new BN(solToLamports(newLimit));
      const tx = await setLimitIx(program, vaultPDA, publicKey, newLimitLamports);
      console.log("Limit updated, tx:", tx);
      toast.success(`Daily limit updated to ${newLimit.toFixed(1)} SOL`);
      await refreshVault();
    } catch (err: any) {
      console.error("Failed to update limit:", err);
      toast.error(err?.message || "Failed to update limit");
    } finally {
      setUpdating(false);
    }
  };

  const handleFreeze = async () => {
    if (!program || !publicKey || !vaultPDA) return;
    setFreezing(true);
    try {
      const tx = await emergencyFreezeIx(program, vaultPDA, publicKey);
      console.log("Vault frozen, tx:", tx);
      toast.success("Vault has been frozen. All tap payments are disabled.");
      await refreshVault();
    } catch (err: any) {
      console.error("Failed to freeze vault:", err);
      toast.error(err?.message || "Failed to freeze vault");
    } finally {
      setFreezing(false);
    }
  };

  return (
    <div className="container py-10 max-w-lg space-y-6">
      <motion.h1
        className="text-2xl font-bold"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        Settings
      </motion.h1>

      {/* Update Daily Limit */}
      <motion.div
        className="glass-card p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Sliders className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold">Daily Spending Limit</h2>
            <p className="text-xs text-muted-foreground">
              Current: {vault.dailyLimit.gte(MAX_U64) ? "Unlimited" : `${lamportsToSol(vault.dailyLimit.toNumber()).toFixed(1)} SOL`}
            </p>
          </div>
        </div>

        <div className="text-center mb-6">
          <div className="text-4xl font-bold gradient-text">{newLimit.toFixed(1)} SOL</div>
          <div className="text-sm text-muted-foreground">≈ ${solToUsd(newLimit)}</div>
        </div>

        <Slider
          value={[newLimit]}
          onValueChange={([v]) => setNewLimit(v)}
          min={0.1}
          max={100}
          step={0.1}
          className="mb-6"
        />

        <Button
          onClick={handleUpdateLimit}
          disabled={updating}
          className="w-full btn-glow bg-primary text-primary-foreground rounded-xl"
        >
          {updating ? (
            <><Loader2 className="mr-2 w-4 h-4 animate-spin" />Updating...</>
          ) : (
            <><Check className="mr-2 w-4 h-4" />Update Limit</>
          )}
        </Button>
      </motion.div>

      {/* Vault Info */}
      <motion.div
        className="glass-card p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <h2 className="font-semibold mb-4">Vault Info</h2>
        <div className="space-y-3 text-sm">
          {[
            ["Status", vault.frozen ? "🔴 Frozen" : "🟢 Active"],
            ["Nonce", vault.nonce.toString()],
            ["Chip Key", truncateAddress(vault.chipPubkey.map(b => b.toString(16).padStart(2, "0")).join(""), 12)],
            ["Owner", truncateAddress(vault.ownerSol.toBase58(), 8)],
            ["Daily Spend", (() => { try { return `${lamportsToSol(vault.dailySpend.toNumber()).toFixed(4)} SOL`; } catch { return "0 SOL"; } })()],
            ["Daily Limit", vault.dailyLimit.gte(MAX_U64) ? "Unlimited" : `${lamportsToSol(vault.dailyLimit.toNumber()).toFixed(4)} SOL`],
            ["Bump", vault.bump.toString()],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between py-2 border-b border-border/30 last:border-0">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-mono text-xs">{value}</span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Danger Zone */}
      <motion.div
        className="glass-card p-6 border-destructive/20"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-5 h-5 text-destructive" />
          <h2 className="font-semibold text-destructive">Danger Zone</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          {vault.frozen
            ? "Your vault is currently frozen. Unfreeze it to resume tap payments."
            : "Freezing your vault will immediately disable all NFC tap payments until you manually unfreeze."}
        </p>

        {vault.frozen ? (
          <Button
            onClick={async () => {
              if (!program || !publicKey || !vaultPDA) return;
              setUnfreezing(true);
              try {
                const tx = await unfreezeIx(program, vaultPDA, publicKey);
                console.log("Vault unfrozen, tx:", tx);
                toast.success("Vault has been unfrozen. Tap payments are enabled again.");
                await refreshVault();
              } catch (err: any) {
                console.error("Failed to unfreeze:", err);
                toast.error(err?.message || "Failed to unfreeze vault");
              } finally {
                setUnfreezing(false);
              }
            }}
            disabled={unfreezing}
            className="w-full rounded-xl bg-success text-success-foreground hover:bg-success/90"
          >
            {unfreezing ? (
              <><Loader2 className="mr-2 w-4 h-4 animate-spin" />Unfreezing...</>
            ) : (
              <><ShieldOff className="mr-2 w-4 h-4" />Unfreeze Vault</>
            )}
          </Button>
        ) : (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="destructive" className="w-full rounded-xl">
                <Shield className="mr-2 w-4 h-4" />
                Emergency Freeze Vault
              </Button>
            </DialogTrigger>
            <DialogContent className="glass-card border-destructive/20">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-destructive" />
                  Freeze Vault?
                </DialogTitle>
                <DialogDescription>
                  This will immediately freeze ALL tap payments. You can unfreeze later from this page.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2">
                <Button variant="outline" className="rounded-xl border-border">Cancel</Button>
                <Button variant="destructive" onClick={handleFreeze} disabled={freezing} className="rounded-xl">
                  {freezing ? (
                    <><Loader2 className="mr-2 w-4 h-4 animate-spin" />Freezing...</>
                  ) : (
                    "Yes, Freeze Now"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </motion.div>
    </div>
  );
}
