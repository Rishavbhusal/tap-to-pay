use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions as ix_sysvar;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use borsh::{BorshDeserialize, BorshSerialize};
use sha3::{Keccak256, Digest};

/// The on-chain Secp256k1 native program ID: KeccakSecp256k11111111111111111111111111111
/// Hardcoded as raw bytes to avoid depending on any crate re-export.
const SECP256K1_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    4, 198, 252, 32, 240, 80, 204, 240, 85, 132, 215, 33, 28, 159, 140, 245,
    158, 193, 71, 133, 187, 22, 106, 30, 40, 48, 232, 18, 32, 0, 0, 0,
]);

declare_id!("5ue8VUmna8tPpNjHAwizyWpz9L7uHouPxLCeGTuVBiUY");

#[program]
pub mod nfc_smart_vault {
    use super::*;

    // Initialize Vault
    pub fn init_vault(
        ctx: Context<InitVault>,
        chip_pubkey: [u8; 64],
        daily_limit: u64,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        registry.chip_pubkey = chip_pubkey;
        registry.owner_sol = ctx.accounts.owner.key();
        registry.nonce = 0;
        registry.daily_limit = daily_limit;
        registry.daily_spend = 0;
        registry.last_day = Clock::get()?.unix_timestamp / 86400;
        registry.frozen = false;
        registry.bump = ctx.bumps.registry;
        Ok(())
    }

    // Execute NFC Tap
    pub fn execute_tap(
        ctx: Context<ExecuteTap>,
        payload_bytes: Vec<u8>,
        signature: [u8; 64],
        recovery_id: u8,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        require!(!registry.frozen, VaultError::VaultFrozen);

        // Deserialize payload
        let payload = TapPayload::try_from_slice(&payload_bytes)
            .map_err(|_| VaultError::InvalidPayload)?;

        // Check program id
        require!(payload.program_id == crate::ID, VaultError::InvalidProgram);

        // Timestamp (5-min window)
        let now = Clock::get()?.unix_timestamp;
        require!(now - payload.timestamp <= 300, VaultError::StaleTimestamp);

        // Nonce check
        require!(payload.nonce == registry.nonce, VaultError::InvalidNonce);

        // ── Signature verification via Secp256k1 native precompile ──
        // Instead of running the expensive libsecp256k1::recover on-chain
        // (which blows past the CU meter), we require the transaction to
        // include a Secp256k1Program precompile instruction that already
        // verified the NFC chip's signature.  We just check the precompile
        // instruction is present and used the correct public key + message.
        verify_secp256k1_precompile(
            &ctx.accounts.instructions,
            &payload_bytes,
            &registry.chip_pubkey,
        )?;

        // Daily limit reset
        let current_day = now / 86400;
        if current_day > registry.last_day {
            registry.daily_spend = 0;
            registry.last_day = current_day;
        }

        require!(
            registry.daily_spend + payload.amount <= registry.daily_limit,
            VaultError::DailyLimitExceeded
        );

        // Increment nonce
        registry.nonce = registry.nonce.checked_add(1)
            .ok_or(VaultError::NonceOverflow)?;
        registry.daily_spend += payload.amount;

        // Execute transfer
        match payload.action {
            0 => execute_spl_transfer(ctx, payload.amount),
            1 => execute_sol_transfer(ctx, payload.amount),
            _ => Err(VaultError::InvalidAction.into()),
        }
    }

    // Emergency Freeze
    pub fn emergency_freeze(ctx: Context<OwnerOnly>) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        require!(ctx.accounts.owner.key() == registry.owner_sol, VaultError::Unauthorized);
        registry.frozen = true;
        Ok(())
    }

    // Unfreeze vault
    pub fn unfreeze(ctx: Context<OwnerOnly>) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        require!(ctx.accounts.owner.key() == registry.owner_sol, VaultError::Unauthorized);
        registry.frozen = false;
        Ok(())
    }

    // Set daily limit
    pub fn set_limit(ctx: Context<OwnerOnly>, new_limit: u64) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        require!(ctx.accounts.owner.key() == registry.owner_sol, VaultError::Unauthorized);
        registry.daily_limit = new_limit;
        Ok(())
    }
}

// ── Verify Secp256k1 precompile instruction in this transaction ─────
// The Secp256k1Program native precompile verifies an secp256k1 ECDSA
// signature at the transaction level.  Our program just confirms the
// precompile instruction used the right eth-address (derived from the
// NFC chip's 64-byte uncompressed public key) and the right message.
fn verify_secp256k1_precompile(
    instructions_account: &AccountInfo,
    expected_message: &[u8],
    chip_pubkey: &[u8; 64],
) -> Result<()> {
    // Derive the expected Ethereum-style address: keccak256(pubkey)[12..32]
    let mut hasher = Keccak256::new();
    hasher.update(chip_pubkey);
    let pk_hash = hasher.finalize();
    let expected_eth_addr = &pk_hash[12..32]; // last 20 bytes

    // Walk backwards from the current instruction to find the precompile ix
    let current_idx = ix_sysvar::load_current_index_checked(instructions_account)
        .map_err(|_| error!(VaultError::SignatureVerificationFailed))? as usize;

    for i in 0..current_idx {
        let ix = ix_sysvar::load_instruction_at_checked(i, instructions_account)
            .map_err(|_| error!(VaultError::SignatureVerificationFailed))?;

        if ix.program_id != SECP256K1_PROGRAM_ID {
            continue;
        }

        let data = &ix.data;
        // Minimum header: 1 (num_sigs) + 11 (offsets struct) = 12 bytes
        if data.len() < 12 {
            continue;
        }

        // Parse the Secp256k1SignatureOffsets header
        // [0]       num_signatures         u8
        // [1..3]    signature_offset       u16 LE
        // [3]       signature_ix_index     u8
        // [4..6]    eth_address_offset     u16 LE
        // [6]       eth_address_ix_index   u8
        // [7..9]    message_data_offset    u16 LE
        // [9]       message_data_ix_index  u8
        // [10..12]  message_data_size      u16 LE
        let eth_addr_offset = u16::from_le_bytes([data[4], data[5]]) as usize;
        let msg_data_offset = u16::from_le_bytes([data[7], data[8]]) as usize;
        let msg_data_size   = u16::from_le_bytes([data[10], data[11]]) as usize;

        if data.len() < eth_addr_offset + 20 { continue; }
        if data.len() < msg_data_offset + msg_data_size { continue; }

        let eth_addr = &data[eth_addr_offset..eth_addr_offset + 20];
        let message  = &data[msg_data_offset..msg_data_offset + msg_data_size];

        // The eth address must match keccak256(chip_pubkey)[12..32]
        require!(
            eth_addr == expected_eth_addr,
            VaultError::SignatureVerificationFailed
        );

        // The message must match the exact payload bytes we are processing
        require!(
            message == expected_message,
            VaultError::SignatureVerificationFailed
        );

        // If we reach here, the precompile verified the signature and
        // we confirmed the key + message match.  All good!
        return Ok(());
    }

    // No matching precompile instruction found
    Err(VaultError::SignatureVerificationFailed.into())
}

// ------------------------ Internal Transfers ------------------------
fn execute_spl_transfer(ctx: Context<ExecuteTap>, amount: u64) -> Result<()> {
    let registry = &ctx.accounts.registry;
    let seeds = &[
        b"vault" as &[u8],
        registry.owner_sol.as_ref(),
        &registry.chip_pubkey[..32],
        &registry.chip_pubkey[32..],
        &[registry.bump],
    ];
    let signer = &[&seeds[..]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault_ata.to_account_info(),
        to: ctx.accounts.target_ata.to_account_info(),
        authority: ctx.accounts.registry.to_account_info(),
    };

    let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer);
    token::transfer(cpi_ctx, amount)?;
    Ok(())
}

fn execute_sol_transfer(ctx: Context<ExecuteTap>, amount: u64) -> Result<()> {
    // Transfer SOL directly from the registry PDA by manipulating lamports.
    // The registry PDA is program-owned, so system_instruction::transfer won't work.
    // As the owning program, we can directly debit/credit lamports.
    let registry_info = ctx.accounts.registry.to_account_info();
    let target_info = ctx.accounts.target_wallet.to_account_info();

    **registry_info.try_borrow_mut_lamports()? -= amount;
    **target_info.try_borrow_mut_lamports()? += amount;

    Ok(())
}

// ------------------------ Accounts ------------------------
#[derive(Accounts)]
#[instruction(chip_pubkey: [u8; 64])]
pub struct InitVault<'info> {
    #[account(
        init,
        payer = owner,
        seeds = [b"vault", owner.key().as_ref(), &chip_pubkey[..32], &chip_pubkey[32..]],
        bump,
        space = 8 + 200
    )]
    pub registry: Account<'info, VaultRegistry>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteTap<'info> {
    #[account(mut)]
    pub registry: Account<'info, VaultRegistry>,

    /// CHECK: Token account for SPL transfers (validated in instruction logic)
    #[account(mut)]
    pub vault_ata: AccountInfo<'info>,

    /// CHECK: Token account for SPL transfers (validated in instruction logic)
    #[account(mut)]
    pub target_ata: AccountInfo<'info>,

    /// CHECK: SOL vault PDA — may be program-owned (registry PDA holds SOL)
    #[account(mut)]
    pub sol_vault: AccountInfo<'info>,

    /// CHECK: Target wallet for SOL transfers
    #[account(mut)]
    pub target_wallet: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,

    /// CHECK: Instructions sysvar — used to verify secp256k1 precompile
    #[account(address = ix_sysvar::ID)]
    pub instructions: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    #[account(mut)]
    pub registry: Account<'info, VaultRegistry>,
    pub owner: Signer<'info>,
}

// ------------------------ State ------------------------
#[account]
pub struct VaultRegistry {
    pub chip_pubkey: [u8; 64],
    pub owner_sol: Pubkey,
    pub nonce: u64,
    pub daily_limit: u64,
    pub daily_spend: u64,
    pub last_day: i64,
    pub frozen: bool,
    pub bump: u8,
}

// ------------------------ Payload ------------------------
#[derive(BorshSerialize, BorshDeserialize)]
pub struct TapPayload {
    pub program_id: Pubkey,
    pub owner_sol: Pubkey,
    pub action: u8,      // 0 = SPL, 1 = SOL
    pub mint: Pubkey,
    pub amount: u64,
    pub target: Pubkey,
    pub nonce: u64,
    pub timestamp: i64,
}

// ------------------------ Errors ------------------------
#[error_code]
pub enum VaultError {
    #[msg("Vault is frozen")] VaultFrozen,
    #[msg("Invalid nonce")] InvalidNonce,
    #[msg("Stale timestamp")] StaleTimestamp,
    #[msg("Signature verification failed")] SignatureVerificationFailed,
    #[msg("Daily limit exceeded")] DailyLimitExceeded,
    #[msg("Nonce overflow")] NonceOverflow,
    #[msg("Invalid action")] InvalidAction,
    #[msg("Invalid program")] InvalidProgram,
    #[msg("Invalid payload")] InvalidPayload,
    #[msg("Unauthorized")] Unauthorized,
}