/**
 * TapVault Relay Server
 *
 * Gasless relay that submits execute_passive_tap transactions on behalf of
 * NFC chip tappers.  Works with both iPhone and Android — no wallet needed
 * at tap time.
 *
 * Flow:
 *   1. User taps NFC chip → NDEF URL opens in browser → frontend parses params
 *   2. Frontend POSTs to /api/relay-tap { pk1, counter, sig1 }
 *   3. Relay looks up vault by chip pubkey
 *   4. Relay builds + signs execute_passive_tap transaction
 *   5. Relay submits to Solana
 *   6. Returns tx signature to frontend
 *
 * Start:
 *   cd relay && npm install && node keygen.js && node server.js
 */

const express = require("express");
const cors = require("cors");
const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} = require("@solana/web3.js");
const anchor = require("@coral-xyz/anchor");
const fs = require("fs");
const path = require("path");

// ── Config ──────────────────────────────────────────────────────────
const PORT = 3001;
const RPC_URL = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("5ue8VUmna8tPpNjHAwizyWpz9L7uHouPxLCeGTuVBiUY");

// ── Load relay keypair ──────────────────────────────────────────────
const keypairPath = path.join(__dirname, "keypair.json");
if (!fs.existsSync(keypairPath)) {
  console.error("ERROR: keypair.json not found. Run 'node keygen.js' first.");
  process.exit(1);
}
const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
const relayKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
console.log("Relay pubkey:", relayKeypair.publicKey.toBase58());

// ── Load IDL ────────────────────────────────────────────────────────
const idlPath = path.join(
  __dirname,
  "../frontend/tapguard-vault/src/lib/idl/nfc_smart_vault.json"
);
const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

// ── Solana connection + Anchor setup ────────────────────────────────
const connection = new Connection(RPC_URL, "confirmed");

// Create a wallet adapter from the relay keypair
const relayWallet = {
  publicKey: relayKeypair.publicKey,
  signTransaction: async (tx) => {
    tx.partialSign(relayKeypair);
    return tx;
  },
  signAllTransactions: async (txs) => {
    txs.forEach((tx) => tx.partialSign(relayKeypair));
    return txs;
  },
};

const provider = new anchor.AnchorProvider(connection, relayWallet, {
  commitment: "confirmed",
});
const program = new anchor.Program(idl, provider);

// ── Helper: find vault by chip pubkey ───────────────────────────────
async function findVaultByChipPubkey(chipPubkeyHex) {
  // Convert hex to bytes (64 bytes, no 04 prefix)
  const clean = chipPubkeyHex.replace(/^0x/, "").replace(/^04/, "");
  if (clean.length !== 128) return null;

  const chipBytes = Buffer.from(clean, "hex");

  // Fetch all vault accounts and find matching chip
  const allVaults = await program.account.vaultRegistry.all();

  for (const v of allVaults) {
    const onChainChip = Buffer.from(v.account.chipPubkey);
    if (onChainChip.equals(chipBytes)) {
      return { pubkey: v.publicKey, account: v.account };
    }
  }

  return null;
}

// ── Express app ─────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    relayPubkey: relayKeypair.publicKey.toBase58(),
  });
});

// Get relay pubkey (frontend needs this for set_tap_config)
app.get("/api/relay-info", (req, res) => {
  res.json({ relayPubkey: relayKeypair.publicKey.toBase58() });
});

/**
 * POST /api/relay-tap
 * Body: { pk1: string (hex, with or without 04 prefix), counter: number }
 *
 * The relay:
 * 1. Finds the vault matching pk1
 * 2. Builds execute_passive_tap(counter)
 * 3. Signs with relay keypair
 * 4. Submits to Solana
 * 5. Returns { txSignature }
 */
app.post("/api/relay-tap", async (req, res) => {
  try {
    const { pk1, counter } = req.body;

    if (!pk1 || counter === undefined || counter === null) {
      return res.status(400).json({ error: "Missing pk1 or counter" });
    }

    const counterNum = parseInt(counter, 10);
    if (isNaN(counterNum) || counterNum <= 0) {
      return res.status(400).json({ error: "Invalid counter value" });
    }

    console.log(`\n[relay-tap] pk1=${pk1.substring(0, 20)}... counter=${counterNum}`);

    // 1. Find vault
    const vault = await findVaultByChipPubkey(pk1);
    if (!vault) {
      return res.status(404).json({ error: "No vault found for this chip" });
    }

    console.log(`[relay-tap] Found vault: ${vault.pubkey.toBase58()}`);
    console.log(`[relay-tap] Tap target: ${vault.account.tapTarget.toBase58()}`);
    console.log(`[relay-tap] Tap amount: ${vault.account.tapAmount.toString()} lamports`);

    // 2. Validate relay authority matches us
    if (!vault.account.relayAuthority.equals(relayKeypair.publicKey)) {
      return res.status(403).json({
        error: "This relay is not authorized for this vault",
        expected: vault.account.relayAuthority.toBase58(),
        got: relayKeypair.publicKey.toBase58(),
      });
    }

    // 3. Validate tap config is set
    if (
      vault.account.tapTarget.equals(PublicKey.default) ||
      vault.account.tapAmount.toNumber() === 0
    ) {
      return res.status(400).json({ error: "Tap config not set on vault" });
    }

    // 4. Validate counter is fresh
    if (counterNum <= vault.account.lastCounter) {
      return res.status(400).json({
        error: "Counter already used (replay attempt)",
        lastCounter: vault.account.lastCounter,
        provided: counterNum,
      });
    }

    // 5. Build + send transaction
    const sig = await program.methods
      .executePassiveTap(counterNum)
      .accounts({
        registry: vault.pubkey,
        targetWallet: vault.account.tapTarget,
        relay: relayKeypair.publicKey,
      })
      .signers([relayKeypair])
      .rpc();

    console.log(`[relay-tap] SUCCESS tx: ${sig}`);

    res.json({ txSignature: sig });
  } catch (err) {
    console.error("[relay-tap] ERROR:", err.message || err);
    res.status(500).json({
      error: err.message || "Transaction failed",
      logs: err?.logs || [],
    });
  }
});

// ── Start server ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\nRelay server running on http://localhost:${PORT}`);
  console.log(`Relay pubkey: ${relayKeypair.publicKey.toBase58()}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /api/health`);
  console.log(`  GET  /api/relay-info`);
  console.log(`  POST /api/relay-tap  { pk1, counter }`);
});
