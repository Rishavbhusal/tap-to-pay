/**
 * Relay keypair generator.
 * Run once:  node keygen.js
 * Creates keypair.json with the relay's secret key.
 * Fund the relay pubkey with devnet SOL: solana airdrop 2 <PUBKEY> --url devnet
 */
const { Keypair } = require("@solana/web3.js");
const fs = require("fs");

const kp = Keypair.generate();
fs.writeFileSync("keypair.json", JSON.stringify(Array.from(kp.secretKey)));
console.log("Relay keypair generated!");
console.log("Public key:", kp.publicKey.toBase58());
console.log("Saved to keypair.json");
console.log("\nFund it on devnet:");
console.log(`  solana airdrop 2 ${kp.publicKey.toBase58()} --url devnet`);
