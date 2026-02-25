import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Zap, Shield, Timer, ArrowRight, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

function RippleAnimation() {
  return (
    <div className="relative w-48 h-48 md:w-64 md:h-64 mx-auto">
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className="absolute inset-0 rounded-full border border-primary/30"
          initial={{ scale: 0.5, opacity: 0.8 }}
          animate={{ scale: 2.5, opacity: 0 }}
          transition={{
            duration: 2.5,
            repeat: Infinity,
            delay: i * 0.6,
            ease: "easeOut",
          }}
        />
      ))}
      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-primary/10 border border-primary/40 flex items-center justify-center shadow-glow">
          <Zap className="w-10 h-10 md:w-12 md:h-12 text-primary" />
        </div>
      </motion.div>
    </div>
  );
}

const features = [
  {
    icon: Zap,
    title: "Instant Payments",
    description: "Tap your NFC chip and pay in under a second. No apps, no QR codes — just tap.",
  },
  {
    icon: Timer,
    title: "Daily Limits",
    description: "Set spending caps that reset every 24 hours. Stay in control of your funds.",
  },
  {
    icon: Shield,
    title: "Emergency Freeze",
    description: "Lost your chip? Freeze your vault instantly from any device.",
  },
];

const stats = [
  { value: "12,847", label: "Vaults Created" },
  { value: "892K", label: "Transactions" },
  { value: "$4.2M", label: "Volume Processed" },
  { value: "0.3s", label: "Avg. Tap Time" },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden pt-16 pb-24 md:pt-28 md:pb-32">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.08),transparent_60%)]" />
        <div className="absolute top-1/4 right-0 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />

        <div className="container relative">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
            <motion.div
              className="flex-1 text-center lg:text-left"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <motion.div
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium mb-6"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                Live on Solana Devnet
              </motion.div>

              <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-4">
                <span className="gradient-text">Tap. Pay.</span>
                <br />
                <span className="text-foreground">Done.</span>
              </h1>

              <p className="text-lg md:text-xl text-muted-foreground max-w-md mx-auto lg:mx-0 mb-8">
                Link your NFC chip to Solana. Pay anywhere with a tap. Set limits. Stay safe.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                <Button asChild size="lg" className="btn-glow bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl text-base font-semibold px-8">
                  <Link to="/dashboard">
                    Launch App
                    <ArrowRight className="ml-2 w-4 h-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="rounded-xl text-base border-border hover:bg-muted">
                  <a href="https://solscan.io" target="_blank" rel="noopener noreferrer">
                    View on Solscan
                    <ChevronRight className="ml-1 w-4 h-4" />
                  </a>
                </Button>
              </div>
            </motion.div>

            <motion.div
              className="flex-1 flex justify-center"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.3 }}
            >
              <RippleAnimation />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 md:py-28">
        <div className="container">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Your wallet, on your <span className="gradient-text">wrist</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-lg mx-auto">
              NFC-powered vaults on Solana. Fast, secure, and always under your control.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {features.map((feat, i) => (
              <motion.div
                key={feat.title}
                className="glass-card-hover p-8"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5">
                  <feat.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{feat.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{feat.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 border-t border-b border-border/50">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                className="text-center"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <div className="text-3xl md:text-4xl font-bold gradient-text mb-1">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12">
        <div className="container text-center text-sm text-muted-foreground">
          <p>Built on Solana • NFC Smart Vault Protocol</p>
        </div>
      </footer>
    </div>
  );
}
