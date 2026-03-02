import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import MobileWalletHelper from "@/components/MobileWalletHelper";
import {
  Wallet,
  ArrowDown,
  Copy,
  Loader2,
  CheckCircle,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import {
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSolana } from "@/hooks/useSolana";
import {
  truncateAddress,
  lamportsToSol,
  solToUsd,
  solToLamports,
  SOLSCAN_BASE,
} from "@/lib/constants";
import { toast } from "sonner";

export default function FundVault() {
  const { connected, publicKey, signTransaction } = useWallet();
  const {
    vault,
    vaultPDA,
    connection,
    balance,
    refreshBalance,
    refreshVault,
    network,
  } = useSolana();

  const [amount, setAmount] = useState("0.1");
  const [sending, setSending] = useState(false);
  const [vaultBalance, setVaultBalance] = useState<number | null>(null);
  const [txSig, setTxSig] = useState("");

  const fetchVaultBalance = useCallback(async () => {
    if (!vaultPDA) {
      setVaultBalance(null);
      return;
    }
    try {
      const bal = await connection.getBalance(vaultPDA);
      setVaultBalance(lamportsToSol(bal));
    } catch {
      setVaultBalance(null);
    }
  }, [vaultPDA, connection]);

  useEffect(() => {
    fetchVaultBalance();
    refreshBalance();
  }, [fetchVaultBalance, refreshBalance]);

  const handleDeposit = async () => {
    if (!publicKey || !vaultPDA || !signTransaction) return;

    const amtFloat = parseFloat(amount);
    if (!amtFloat || amtFloat <= 0) {
      toast.error("Enter a valid amount");
      return;
    }

    setSending(true);
    setTxSig("");
    try {
      const lamports = solToLamports(amtFloat);

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: vaultPDA,
          lamports,
        })
      );

      tx.feePayer = publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(sig, "confirmed");
      setTxSig(sig);
      toast.success(`Deposited ${amtFloat} SOL into vault!`);
      fetchVaultBalance();
      refreshBalance();
    } catch (err: any) {
      console.error("Deposit failed:", err);
      toast.error(err?.message || "Failed to deposit");
    } finally {
      setSending(false);
    }
  };

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    toast.success("Copied to clipboard");
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
            Connect a Solana wallet to fund your vault.
          </p>
          <WalletMultiButton />
          <MobileWalletHelper />
        </motion.div>
      </motion.div>
    );
  }

  if (!vault || !vaultPDA) {
    return (
      <div className="container py-10 max-w-lg text-center">
        <div className="glass-card p-12">
          <Wallet className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
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
    <div className="container py-10 max-w-lg space-y-6">
      <motion.h1
        className="text-2xl font-bold"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        Fund Vault
      </motion.h1>

      {/* Vault Balance Card */}
      <motion.div
        className="glass-card p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-muted-foreground">Vault SOL Balance</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchVaultBalance}
            className="h-7 w-7 p-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="text-3xl font-bold mb-1">
          {vaultBalance !== null ? `${vaultBalance.toFixed(4)} SOL` : "Loading..."}
        </div>
        {vaultBalance !== null && (
          <p className="text-sm text-muted-foreground">
            ≈ ${solToUsd(vaultBalance)}
          </p>
        )}
      </motion.div>

      {/* Vault PDA Address */}
      <motion.div
        className="glass-card p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Vault PDA Address</h2>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono bg-muted rounded-lg px-3 py-2 break-all">
            {vaultPDA.toBase58()}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => copyAddress(vaultPDA.toBase58())}
            className="shrink-0"
          >
            <Copy className="w-3.5 h-3.5" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          You can also send SOL directly to this address from any wallet.
        </p>
      </motion.div>

      {/* Deposit Form */}
      <motion.div
        className="glass-card p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <ArrowDown className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold">Deposit SOL</h2>
            <p className="text-xs text-muted-foreground">
              Wallet balance: {balance !== null ? `${balance.toFixed(4)} SOL` : "..."}
            </p>
          </div>
        </div>

        <div className="mb-4">
          <label className="text-sm text-muted-foreground mb-1.5 block">
            Amount (SOL)
          </label>
          <Input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="text-2xl font-bold text-center h-14 bg-muted border-border"
            step="0.01"
            min="0.001"
          />
          <p className="text-center text-sm text-muted-foreground mt-1">
            ≈ ${solToUsd(parseFloat(amount) || 0)}
          </p>
        </div>

        {/* Quick amounts */}
        <div className="flex gap-2 mb-4">
          {[0.05, 0.1, 0.5, 1].map((val) => (
            <Button
              key={val}
              variant="outline"
              size="sm"
              onClick={() => setAmount(val.toString())}
              className="flex-1 rounded-lg text-xs border-border"
            >
              {val} SOL
            </Button>
          ))}
        </div>

        <Button
          onClick={handleDeposit}
          disabled={
            sending || !amount || parseFloat(amount) <= 0
          }
          className="w-full btn-glow bg-primary text-primary-foreground rounded-xl h-12 text-base"
        >
          {sending ? (
            <>
              <Loader2 className="mr-2 w-4 h-4 animate-spin" />
              Depositing...
            </>
          ) : (
            <>
              <ArrowDown className="mr-2 w-4 h-4" />
              Deposit to Vault
            </>
          )}
        </Button>

        {txSig && (
          <div className="mt-4 p-3 bg-success/10 border border-success/30 rounded-lg text-center">
            <div className="flex items-center justify-center gap-1 text-success text-sm mb-1">
              <CheckCircle className="w-4 h-4" />
              Deposit Successful
            </div>
            <a
              href={`${SOLSCAN_BASE}/${txSig}?cluster=${network}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {truncateAddress(txSig, 8)} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </motion.div>
    </div>
  );
}
