// Polyfill Node.js globals needed by @arx-research/libhalo
import { Buffer } from "buffer";
(window as any).global = window;
(window as any).Buffer = Buffer;
(window as any).process = (window as any).process || { env: {}, version: "", browser: true };

// Patch Transaction.serialize for Mobile Wallet Adapter compatibility.
// MWA adapter calls .serialize() on unsigned transactions before sending them
// to the wallet for signing. The default serialize() requires all signatures
// to be present, which fails for unsigned txs. This patch makes it lenient.
import { Transaction } from "@solana/web3.js";
const _origSerialize = Transaction.prototype.serialize;
Transaction.prototype.serialize = function (config?: any) {
  return _origSerialize.call(this, {
    requireAllSignatures: false,
    verifySignatures: false,
    ...config,
  });
};

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
