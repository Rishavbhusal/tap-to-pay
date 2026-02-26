import { useMemo } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { SolanaProvider } from "@/hooks/useSolana";
import Navbar from "@/components/Navbar";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import Setup from "./pages/Setup";
import TapPage from "./pages/Tap";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
// Register page removed

import "@solana/wallet-adapter-react-ui/styles.css";

const queryClient = new QueryClient();

const App = () => {
  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
  ], []);

  return (
    <ConnectionProvider endpoint="https://api.devnet.solana.com">
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              <BrowserRouter>
                <SolanaProvider>
                  <Navbar />
                  <Routes>
                    <Route path="/" element={<Index />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/setup" element={<Setup />} />
                    {/* Register route removed */}
                    <Route path="/tap" element={<TapPage />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </SolanaProvider>
              </BrowserRouter>
            </TooltipProvider>
          </QueryClientProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default App;
