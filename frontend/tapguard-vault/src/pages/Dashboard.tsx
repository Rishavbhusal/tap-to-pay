import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import MobileWalletHelper from "@/components/MobileWalletHelper";
import { BN } from "@coral-xyz/anchor";
import {
  Wallet,
  Plus,
  Shield,
  Timer,
  Zap,
  Copy,
  ChevronDown,
  RefreshCw,
  ExternalLink,
  ArrowDown,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSolana } from "@/hooks/useSolana";
import { truncateAddress, lamportsToSol, solToUsd, SOLSCAN_BASE } from "@/lib/constants";
import { toast } from "sonner";
import type { ConfirmedSignatureInfo } from "@solana/web3.js";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

function ConnectOverlay() {
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
          Connect a Solana wallet to access your vault dashboard.
        </p>
        <WalletMultiButton />
        <MobileWalletHelper />
      </motion.div>
    </motion.div>
  );
}

function SpendingRing({ spent, limit }: { spent: number; limit: number }) {
  const pct = Math.min((spent / limit) * 100, 100);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="relative w-36 h-36 mx-auto">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
        <motion.circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: "easeOut" }}
          style={{ filter: "drop-shadow(0 0 6px hsl(var(--primary) / 0.5))" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold">{pct.toFixed(0)}%</span>
        <span className="text-xs text-muted-foreground">used</span>
      </div>
    </div>
  );
}

// Max u64 as BN — used to detect "unlimited" daily limit
const MAX_U64 = new BN("18446744073709551615");

/** Safely convert a BN to a JS number; returns Infinity for huge values */
function safeToNumber(bn: BN): number {
  try {
    if (bn.gte(MAX_U64)) return Infinity;
    return bn.toNumber();
  } catch {
    return Infinity;
  }
}

export default function Dashboard() {
  const { connected, publicKey } = useWallet();
  const { balance, vault, vaultPDA, network, refreshVault, refreshBalance, connection } = useSolana();
  const [recentTxs, setRecentTxs] = useState<ConfirmedSignatureInfo[]>([]);
  const [txLoading, setTxLoading] = useState(false);

  const fetchTxHistory = useCallback(async () => {
    if (!vaultPDA) return;
    setTxLoading(true);
    try {
      const sigs = await connection.getSignaturesForAddress(vaultPDA, { limit: 10 });
      setRecentTxs(sigs);
    } catch (err) {
      console.error("Failed to fetch tx history:", err);
    } finally {
      setTxLoading(false);
    }
  }, [vaultPDA, connection]);

  // Re-fetch vault & balance every time Dashboard mounts
  useEffect(() => {
    refreshVault();
    refreshBalance();
    fetchTxHistory();
  }, [fetchTxHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!connected) return <ConnectOverlay />;

  const noVault = !vault;

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    toast.success("Copied to clipboard");
  };

  // Calculate hours until midnight UTC
  const now = new Date();
  const resetHours = 24 - now.getUTCHours();

  // Safely extract numeric values for display
  const dailySpent = vault ? safeToNumber(vault.dailySpend) : 0;
  const dailyLimit = vault ? safeToNumber(vault.dailyLimit) : Infinity;
  const isUnlimited = dailyLimit === Infinity;

  return (
    <div className="container py-6 max-w-4xl">
      {/* Top bar */}
      <motion.div
        className="glass-card p-4 flex flex-wrap items-center justify-between gap-3 mb-6"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => copyAddress(publicKey!.toBase58())}
            className="flex items-center gap-1.5 text-sm font-mono bg-muted px-3 py-1.5 rounded-lg hover:bg-muted/80 transition"
          >
            {truncateAddress(publicKey!.toBase58(), 6)}
            <Copy className="w-3 h-3 text-muted-foreground" />
          </button>
          <span className={network === "devnet" ? "network-badge-devnet" : "network-badge-mainnet"}>
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            {network === "devnet" ? "Devnet" : "Mainnet"}
          </span>
        </div>
        <div className="text-sm font-medium">
          {balance !== null ? (
            <>
              <span className="text-foreground">{balance.toFixed(4)} SOL</span>
              <span className="text-muted-foreground ml-2">(${solToUsd(balance)})</span>
            </>
          ) : (
            <span className="text-muted-foreground">Loading...</span>
          )}
        </div>
      </motion.div>

      {noVault ? (
        /* No vault state */
        <motion.div
          className="glass-card p-12 text-center"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-6">
            <Plus className="w-10 h-10 text-primary" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Create Your Vault</h2>
          <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
            Link an NFC chip and set up your smart vault to start making tap payments.
          </p>
          <Button asChild size="lg" className="btn-glow bg-primary text-primary-foreground rounded-xl px-8">
            <Link to="/setup">
              <Zap className="mr-2 w-4 h-4" />
              Set Up Vault
            </Link>
          </Button>
        </motion.div>
      ) : (
        <div className="space-y-6">
          {/* Status + Spending */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Vault Status */}
            <motion.div
              className="glass-card p-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Vault Status</h3>
              <div className="flex items-center gap-3 mb-4">
                <span
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold ${
                    vault.frozen
                      ? "bg-destructive/15 text-destructive border border-destructive/30"
                      : "bg-success/15 text-success border border-success/30"
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
                  {vault.frozen ? "FROZEN" : "ACTIVE"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground font-mono">
                PDA: {truncateAddress(publicKey!.toBase58(), 8)}
              </div>
            </motion.div>

            {/* Daily Spending */}
            <motion.div
              className="glass-card p-6"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Daily Spending</h3>
              {isUnlimited ? (
                <div className="text-center py-6">
                  <span className="text-3xl font-bold">∞</span>
                  <p className="text-xs text-muted-foreground mt-1">Unlimited</p>
                </div>
              ) : (
                <SpendingRing spent={dailySpent} limit={dailyLimit} />
              )}
              <div className="flex justify-between mt-4 text-sm">
                <span className="text-muted-foreground">
                  {lamportsToSol(dailySpent).toFixed(2)} / {isUnlimited ? "∞" : lamportsToSol(dailyLimit).toFixed(2)} SOL
                </span>
                <span className="text-muted-foreground flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" />
                  Resets in {resetHours}h
                </span>
              </div>
            </motion.div>
          </div>

          {/* Quick Actions */}
          <motion.div
            className="grid grid-cols-4 gap-3"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Button asChild variant="outline" className="glass-card-hover h-auto py-4 flex flex-col gap-2 border-primary/20 hover:border-primary/40">
              <Link to="/settings">
                <Timer className="w-5 h-5 text-primary" />
                <span className="text-xs">Set Limit</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="glass-card-hover h-auto py-4 flex flex-col gap-2 border-primary/20 hover:border-primary/40">
              <Link to="/tap">
                <Zap className="w-5 h-5 text-primary" />
                <span className="text-xs">Tap to Pay</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="glass-card-hover h-auto py-4 flex flex-col gap-2 border-primary/20 hover:border-primary/40">
              <Link to="/fund">
                <ArrowDown className="w-5 h-5 text-primary" />
                <span className="text-xs">Fund</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="glass-card-hover h-auto py-4 flex flex-col gap-2 border-destructive/20 hover:border-destructive/40">
              <Link to="/settings">
                <Shield className="w-5 h-5 text-destructive" />
                <span className="text-xs">Freeze</span>
              </Link>
            </Button>
          </motion.div>

          {/* Recent Transactions */}
          <motion.div
            className="glass-card p-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-muted-foreground">Recent Transactions</h3>
              <Button variant="ghost" size="sm" onClick={fetchTxHistory} className="h-7 w-7 p-0">
                {txLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              </Button>
            </div>
            {txLoading && recentTxs.length === 0 ? (
              <div className="text-center py-8">
                <Loader2 className="w-6 h-6 text-muted-foreground mx-auto animate-spin" />
              </div>
            ) : recentTxs.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">
                No transactions yet. Fund your vault or make a tap payment.
              </p>
            ) : (
              <div className="space-y-2">
                {recentTxs.map((tx) => (
                  <a
                    key={tx.signature}
                    href={`${SOLSCAN_BASE}/${tx.signature}?cluster=${network}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition text-sm group"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${tx.err ? 'bg-destructive' : 'bg-success'}`} />
                      <span className="font-mono text-xs text-muted-foreground">
                        {truncateAddress(tx.signature, 8)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {tx.blockTime ? new Date(tx.blockTime * 1000).toLocaleString() : ""}
                      </span>
                      <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
                    </div>
                  </a>
                ))}
              </div>
            )}
          </motion.div>

          {/* Vault Details */}
          <Accordion type="single" collapsible>
            <AccordionItem value="vault-details" className="glass-card border-glass-border rounded-2xl overflow-hidden">
              <AccordionTrigger className="px-6 py-4 text-sm font-medium text-muted-foreground hover:no-underline hover:text-foreground">
                <span className="flex items-center gap-2">
                  <ChevronDown className="w-4 h-4" />
                  Vault Details
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-6">
                <div className="grid gap-3 text-sm">
                  {[
                    ["Nonce", vault.nonce.toString()],
                    ["Chip Pubkey", truncateAddress(vault.chipPubkey.map(b => b.toString(16).padStart(2, "0")).join(""), 16)],
                    ["Owner", vault.ownerSol.toBase58()],
                    ["Bump", vault.bump.toString()],
                    ["Last Day", new Date(safeToNumber(vault.lastDay) * 86400 * 1000).toLocaleDateString()],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between items-center py-2 border-b border-border/30 last:border-0">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-mono text-xs">{value}</span>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      )}
    </div>
  );
}
