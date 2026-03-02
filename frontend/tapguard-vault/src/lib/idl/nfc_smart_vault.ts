/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * pointy snake_case IDL can be found at `nfc_smart_vault.json`.
 */
export type NfcSmartVault = {
  address: "5ue8VUmna8tPpNjHAwizyWpz9L7uHouPxLCeGTuVBiUY";
  metadata: {
    name: "nfcSmartVault";
    version: "0.1.0";
    spec: "0.1.0";
    description: "Created with Anchor";
  };
  instructions: [
    {
      name: "emergencyFreeze";
      discriminator: [179, 69, 168, 100, 173, 7, 136, 112];
      accounts: [
        { name: "registry"; writable: true },
        { name: "owner"; signer: true }
      ];
      args: [];
    },
    {
      name: "executeTap";
      discriminator: [75, 138, 138, 92, 84, 247, 107, 89];
      accounts: [
        { name: "registry"; writable: true },
        { name: "vaultAta"; writable: true },
        { name: "targetAta"; writable: true },
        { name: "solVault"; writable: true },
        { name: "targetWallet"; writable: true },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        }
      ];
      args: [
        { name: "payloadBytes"; type: "bytes" },
        { name: "signature"; type: { array: ["u8", 64] } },
        { name: "recoveryId"; type: "u8" }
      ];
    },
    {
      name: "initVault";
      discriminator: [77, 79, 85, 150, 33, 217, 52, 106];
      accounts: [
        { name: "registry"; writable: true },
        { name: "owner"; writable: true; signer: true },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        }
      ];
      args: [
        { name: "chipPubkey"; type: { array: ["u8", 64] } },
        { name: "dailyLimit"; type: "u64" }
      ];
    },
    {
      name: "setLimit";
      discriminator: [51, 224, 252, 238, 154, 84, 60, 174];
      accounts: [
        { name: "registry"; writable: true },
        { name: "owner"; signer: true }
      ];
      args: [{ name: "newLimit"; type: "u64" }];
    },
    {
      name: "unfreeze";
      discriminator: [133, 160, 68, 253, 80, 232, 218, 247];
      accounts: [
        { name: "registry"; writable: true },
        { name: "owner"; signer: true }
      ];
      args: [];
    }
  ];
  accounts: [
    {
      name: "vaultRegistry";
      discriminator: [15, 54, 133, 46, 80, 169, 250, 79];
    }
  ];
  errors: [
    { code: 6000; name: "vaultFrozen"; msg: "Vault is frozen" },
    { code: 6001; name: "invalidNonce"; msg: "Invalid nonce" },
    { code: 6002; name: "staleTimestamp"; msg: "Stale timestamp" },
    {
      code: 6003;
      name: "signatureVerificationFailed";
      msg: "Signature verification failed";
    },
    {
      code: 6004;
      name: "dailyLimitExceeded";
      msg: "Daily limit exceeded";
    },
    { code: 6005; name: "nonceOverflow"; msg: "Nonce overflow" },
    { code: 6006; name: "invalidAction"; msg: "Invalid action" },
    { code: 6007; name: "invalidProgram"; msg: "Invalid program" },
    { code: 6008; name: "invalidPayload"; msg: "Invalid payload" },
    { code: 6009; name: "unauthorized"; msg: "Unauthorized" }
  ];
  types: [
    {
      name: "vaultRegistry";
      type: {
        kind: "struct";
        fields: [
          { name: "chipPubkey"; type: { array: ["u8", 64] } },
          { name: "ownerSol"; type: "pubkey" },
          { name: "nonce"; type: "u64" },
          { name: "dailyLimit"; type: "u64" },
          { name: "dailySpend"; type: "u64" },
          { name: "lastDay"; type: "i64" },
          { name: "frozen"; type: "bool" },
          { name: "bump"; type: "u8" }
        ];
      };
    }
  ];
};
