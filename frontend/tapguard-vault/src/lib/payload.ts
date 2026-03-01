/**
 * TapPayload Borsh serialization + Keccak256 hashing.
 *
 * Matches the on-chain struct:
 *   pub struct TapPayload {
 *     pub program_id: Pubkey,   // 32 bytes
 *     pub owner_sol:  Pubkey,   // 32 bytes
 *     pub action:     u8,       // 1 byte  (0 = SPL, 1 = SOL)
 *     pub mint:       Pubkey,   // 32 bytes
 *     pub amount:     u64,      // 8 bytes LE
 *     pub target:     Pubkey,   // 32 bytes
 *     pub nonce:      u64,      // 8 bytes LE
 *     pub timestamp:  i64,      // 8 bytes LE
 *   }
 *   Total: 153 bytes
 */
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { keccak256 } from "js-sha3";

export interface TapPayloadFields {
  programId: PublicKey;
  ownerSol: PublicKey;
  action: number; // 0 = SPL, 1 = SOL
  mint: PublicKey;
  amount: BN;
  target: PublicKey;
  nonce: BN;
  timestamp: BN; // unix seconds
}

/** Borsh-serialize a TapPayload (153 bytes, all little-endian). */
export function serializeTapPayload(p: TapPayloadFields): Uint8Array {
  const buf = new ArrayBuffer(153);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let off = 0;

  // programId (32)
  bytes.set(p.programId.toBytes(), off);
  off += 32;

  // ownerSol (32)
  bytes.set(p.ownerSol.toBytes(), off);
  off += 32;

  // action (u8)
  view.setUint8(off, p.action);
  off += 1;

  // mint (32)
  bytes.set(p.mint.toBytes(), off);
  off += 32;

  // amount (u64 LE)
  const amountArr = p.amount.toArray("le", 8);
  bytes.set(amountArr, off);
  off += 8;

  // target (32)
  bytes.set(p.target.toBytes(), off);
  off += 32;

  // nonce (u64 LE)
  const nonceArr = p.nonce.toArray("le", 8);
  bytes.set(nonceArr, off);
  off += 8;

  // timestamp (i64 LE)
  const tsArr = p.timestamp.toArray("le", 8);
  bytes.set(tsArr, off);

  return bytes;
}

/** Keccak256 hash the raw payload bytes → 32-byte hex string (no 0x prefix). */
export function hashPayload(payloadBytes: Uint8Array): string {
  return keccak256(payloadBytes); // returns hex string (64 chars)
}

/**
 * Parse a DER-encoded ECDSA signature into raw (r, s) 32-byte buffers.
 * Also accepts a `v` recovery id.
 */
export function derToRaw(derHex: string): { r: Uint8Array; s: Uint8Array } {
  const der = hexToBytes(derHex);
  // DER: 0x30 <len> 0x02 <rlen> <r> 0x02 <slen> <s>
  let idx = 2; // skip 30 <len>
  if (der[0] !== 0x30) throw new Error("Invalid DER signature");
  idx = 2;

  // R
  if (der[idx] !== 0x02) throw new Error("Invalid DER: expected 0x02 for R");
  idx++;
  const rLen = der[idx++];
  const rRaw = der.slice(idx, idx + rLen);
  idx += rLen;

  // S
  if (der[idx] !== 0x02) throw new Error("Invalid DER: expected 0x02 for S");
  idx++;
  const sLen = der[idx++];
  const sRaw = der.slice(idx, idx + sLen);

  // Pad/trim to 32 bytes
  const r = padTo32(rRaw);
  const s = padTo32(sRaw);
  return { r, s };
}

function padTo32(arr: Uint8Array): Uint8Array {
  if (arr.length === 32) return arr;
  if (arr.length > 32) return arr.slice(arr.length - 32); // strip leading 0x00
  const out = new Uint8Array(32);
  out.set(arr, 32 - arr.length);
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
