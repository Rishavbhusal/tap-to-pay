import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, CheckCircle, Loader2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { solToUsd } from "@/lib/constants";

type TapState = "idle" | "waiting" | "verifying" | "success";

export default function TapPage() {
  const [amount, setAmount] = useState("0.5");
  const [state, setState] = useState<TapState>("idle");

  const startTap = () => {
    setState("waiting");
    // Simulate NFC tap after delay
    setTimeout(() => {
      setState("verifying");
      setTimeout(() => setState("success"), 1500);
    }, 3000);
  };

  const reset = () => {
    setState("idle");
    setAmount("0.5");
  };

  return (
    <div className="container py-10 max-w-md">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold mb-1">Tap to Pay</h1>
          <p className="text-muted-foreground text-sm">Merchant payment terminal</p>
        </div>

        <AnimatePresence mode="wait">
          {state === "idle" && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="glass-card p-8"
            >
              <label className="text-sm text-muted-foreground mb-2 block">Payment Amount (SOL)</label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="text-3xl font-bold text-center h-16 bg-muted border-border mb-2"
                step="0.01"
                min="0.01"
              />
              <p className="text-center text-sm text-muted-foreground mb-6">
                ≈ ${solToUsd(parseFloat(amount) || 0)}
              </p>

              <Button onClick={startTap} className="w-full btn-glow bg-primary text-primary-foreground rounded-xl h-14 text-base" disabled={!amount || parseFloat(amount) <= 0}>
                <Smartphone className="mr-2 w-5 h-5" />
                Request Payment
              </Button>
            </motion.div>
          )}

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
                    transition={{ duration: 2, repeat: Infinity, delay: i * 0.5 }}
                  />
                ))}
                <div className="absolute inset-0 flex items-center justify-center">
                  <Zap className="w-12 h-12 text-primary pulse-nfc" />
                </div>
              </div>
              <h2 className="text-xl font-bold mb-1">Waiting for tap...</h2>
              <p className="text-muted-foreground text-sm mb-2">{amount} SOL (${solToUsd(parseFloat(amount))})</p>
              <Button variant="outline" onClick={reset} className="mt-4 rounded-xl border-border">Cancel</Button>
            </motion.div>
          )}

          {state === "verifying" && (
            <motion.div
              key="verifying"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="glass-card p-12 text-center"
            >
              <Loader2 className="w-12 h-12 text-primary mx-auto mb-4 animate-spin" />
              <h2 className="text-xl font-bold mb-1">Verifying...</h2>
              <p className="text-muted-foreground text-sm">Confirming transaction on Solana</p>
            </motion.div>
          )}

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
                <CheckCircle className="w-20 h-20 text-success mx-auto mb-4" style={{ filter: "drop-shadow(0 0 20px hsl(var(--success) / 0.5))" }} />
              </motion.div>
              <h2 className="text-2xl font-bold mb-1 text-success">Payment Confirmed</h2>
              <p className="text-3xl font-bold mb-1">{amount} SOL</p>
              <p className="text-muted-foreground text-sm mb-6">${solToUsd(parseFloat(amount))}</p>
              <Button onClick={reset} className="rounded-xl bg-primary text-primary-foreground">New Payment</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
