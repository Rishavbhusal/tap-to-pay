use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions as ix_sysvar;
use anchor_spl::token::{self, Token, Transfer};
use borsh::{BorshDeserialize, BorshSerialize};
use sha3::{Keccak256, Digest};

/// The on-chain Secp256k1 native program ID: KeccakSecp256k11111111111111111111111111111
const SECP256K1_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    4, 198, 252, 32, 240, 80, 204, 240, 85, 132, 215, 33, 28, 159, 140, 245,
    158, 193, 71, 133, 187, 22, 106, 30, 40, 48, 232, 18, 32, 0, 0, 0,
]);

declare_id!("6w8VdnhWQpPypZyVtYiq7ajznigpnwa72DmWGX3GveL8");

#[program]
pub mod nfc_smart_vault {
    use super::*;

    /// Initialize Vault — expanded with relay/tap config fields
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
        // New passive-tap fields default to "not configured"
        registry.relay_authority = Pubkey::default();
        registry.tap_target = Pubkey::default();
        registry.tap_amount = 0;
        registry.last_counter = 0;
        Ok(())
    }

    /// Configure passive-tap settings (owner only).
    /// Sets the relay authority, target wallet, and per-tap amount.
    pub fn set_tap_config(
        ctx: Context<OwnerOnly>,
        target: Pubkey,
        amount: u64,
        relay: Pubkey,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        require!(ctx.accounts.owner.key() == registry.owner_sol, VaultError::Unauthorized);
        registry.tap_target = target;
        registry.tap_amount = amount;
        registry.relay_authority = relay;
        Ok(())
    }

    /// Execute a passive NFC tap (relay-submitted, works on any device).
    /// The trusted relay verifies the NFC chip signature off-chain, then
    /// submits this instruction signed with its own keypair.
    /// On-chain we check: relay is authorized, counter is fresh, limits ok.
    pub fn execute_passive_tap(
        ctx: Context<ExecutePassiveTap>,
        counter: u32,
    ) -> Result<()> {
        // Read all needed values from registry first, then drop the mutable borrow
        let tap_amount: u64;
        {
            let registry = &mut ctx.accounts.registry;
            require!(!registry.frozen, VaultError::VaultFrozen);

            // Relay must be the authorized relay for this vault
            require!(
                ctx.accounts.relay.key() == registry.relay_authority,
                VaultError::Unauthorized
            );

            // Tap config must be set
            require!(
                registry.tap_target != Pubkey::default(),
                VaultError::InvalidAction
            );
            require!(registry.tap_amount > 0, VaultError::InvalidAction);

            // Target wallet must match the configured tap_target
            require!(
                ctx.accounts.target_wallet.key() == registry.tap_target,
                VaultError::Unauthorized
            );

            // Counter must strictly increase (prevents replay of same NFC URL)
            require!(counter > registry.last_counter, VaultError::InvalidNonce);
            registry.last_counter = counter;

            // Daily limit check
            let now = Clock::get()?.unix_timestamp;
            let current_day = now / 86400;
            if current_day > registry.last_day {
                registry.daily_spend = 0;
                registry.last_day = current_day;
            }
            require!(
                registry.daily_spend + registry.tap_amount <= registry.daily_limit,
                VaultError::DailyLimitExceeded
            );
            registry.daily_spend += registry.tap_amount;
            tap_amount = registry.tap_amount;
        }

        // SOL transfer: debit registry PDA, credit target
        // (no mutable borrow of registry alive here)
        let registry_info = ctx.accounts.registry.to_account_info();
        let target_info = ctx.accounts.target_wallet.to_account_info();
        **registry_info.try_borrow_mut_lamports()? -= tap_amount;
        **target_info.try_borrow_mut_lamports()? += tap_amount;

        Ok(())
    }

    /// Execute NFC Tap (active mode — Android only, wallet-signed).
    /// Uses secp256k1 precompile for on-chain signature verification.
    pub fn execute_tap(
        ctx: Context<ExecuteTap>,
        payload_bytes: Vec<u8>,
        _signature: [u8; 64],
        _recovery_id: u8,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        require!(!registry.frozen, VaultError::VaultFrozen);

        let payload = TapPayload::try_from_slice(&payload_bytes)
            .map_err(|_| VaultError::InvalidPayload)?;

        require!(payload.program_id == crate::ID, VaultError::InvalidProgram);

        let now = Clock::get()?.unix_timestamp;
        require!(now - payload.timestamp <= 300, VaultError::StaleTimestamp);
        require!(payload.nonce == registry.nonce, VaultError::InvalidNonce);

        // Verify secp256k1 precompile instruction is in the transaction
        verify_secp256k1_precompile(
            &ctx.accounts.instructions,
            &payload_bytes,
            &registry.chip_pubkey,
        )?;

        let current_day = now / 86400;
        if current_day > registry.last_day {
            registry.daily_spend = 0;
            registry.last_day = current_day;
        }
        require!(
            registry.daily_spend + payload.amount <= registry.daily_limit,
            VaultError::DailyLimitExceeded
        );

        registry.nonce = registry.nonce.checked_add(1)
            .ok_or(VaultError::NonceOverflow)?;
        registry.daily_spend += payload.amount;

        match payload.action {
            0 => execute_spl_transfer(ctx, payload.amount),
            1 => execute_sol_transfer(ctx, payload.amount),
            _ => Err(VaultError::InvalidAction.into()),
        }
    }

    pub fn emergency_freeze(ctx: Context<OwnerOnly>) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        require!(ctx.accounts.owner.key() == registry.owner_sol, VaultError::Unauthorized);
        registry.frozen = true;
        Ok(())
    }

    pub fn unfreeze(ctx: Context<OwnerOnly>) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        require!(ctx.accounts.owner.key() == registry.owner_sol, VaultError::Unauthorized);
        registry.frozen = false;
        Ok(())
    }

    pub fn set_limit(ctx: Context<OwnerOnly>, new_limit: u64) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        require!(ctx.accounts.owner.key() == registry.owner_sol, VaultError::Unauthorized);
        registry.daily_limit = new_limit;
        Ok(())
    }
}

// ── Secp256k1 precompile verification (for active tap mode) ─────────
fn verify_secp256k1_precompile(
    instructions_account: &AccountInfo,
    expected_message: &[u8],
    chip_pubkey: &[u8; 64],
) -> Result<()> {
    let mut hasher = Keccak256::new();
    hasher.update(chip_pubkey);
    let pk_hash = hasher.finalize();
    let expected_eth_addr = &pk_hash[12..32];

    let current_idx = ix_sysvar::load_current_index_checked(instructions_account)
        .map_err(|_| error!(VaultError::SignatureVerificationFailed))? as usize;

    for i in 0..current_idx {
        let ix = ix_sysvar::load_instruction_at_checked(i, instructions_account)
            .map_err(|_| error!(VaultError::SignatureVerificationFailed))?;

        if ix.program_id != SECP256K1_PROGRAM_ID {
            continue;
        }

        let data = &ix.data;
        if data.len() < 12 { continue; }

        let eth_addr_offset = u16::from_le_bytes([data[4], data[5]]) as usize;
        let msg_data_offset = u16::from_le_bytes([data[7], data[8]]) as usize;
        let msg_data_size   = u16::from_le_bytes([data[9], data[10]]) as usize;

        if data.len() < eth_addr_offset + 20 { continue; }
        if data.len() < msg_data_offset + msg_data_size { continue; }

        let eth_addr = &data[eth_addr_offset..eth_addr_offset + 20];
        let message  = &data[msg_data_offset..msg_data_offset + msg_data_size];

        require!(eth_addr == expected_eth_addr, VaultError::SignatureVerificationFailed);
        require!(message == expected_message,   VaultError::SignatureVerificationFailed);

        return Ok(());
    }

    Err(VaultError::SignatureVerificationFailed.into())
}

// ── Internal Transfers ──────────────────────────────────────────────
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
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer,
    );
    token::transfer(cpi_ctx, amount)?;
    Ok(())
}

fn execute_sol_transfer(ctx: Context<ExecuteTap>, amount: u64) -> Result<()> {
    let registry_info = ctx.accounts.registry.to_account_info();
    let target_info = ctx.accounts.target_wallet.to_account_info();
    **registry_info.try_borrow_mut_lamports()? -= amount;
    **target_info.try_borrow_mut_lamports()? += amount;
    Ok(())
}

// ── Accounts ────────────────────────────────────────────────────────
#[derive(Accounts)]
#[instruction(chip_pubkey: [u8; 64])]
pub struct InitVault<'info> {
    #[account(
        init,
        payer = owner,
        seeds = [b"vault", owner.key().as_ref(), &chip_pubkey[..32], &chip_pubkey[32..]],
        bump,
        space = 8 + 280   // expanded for new fields
    )]
    pub registry: Account<'info, VaultRegistry>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Passive tap — relay-submitted, no wallet needed at tap time
#[derive(Accounts)]
pub struct ExecutePassiveTap<'info> {
    #[account(mut)]
    pub registry: Account<'info, VaultRegistry>,

    /// CHECK: Target wallet — must match registry.tap_target (checked in instruction)
    #[account(mut)]
    pub target_wallet: AccountInfo<'info>,

    /// The relay keypair that signed this transaction
    pub relay: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Active tap — wallet-signed with secp256k1 precompile
#[derive(Accounts)]
pub struct ExecuteTap<'info> {
    #[account(mut)]
    pub registry: Account<'info, VaultRegistry>,

    /// CHECK: Token account for SPL transfers
    #[account(mut)]
    pub vault_ata: AccountInfo<'info>,

    /// CHECK: Token account for SPL transfers
    #[account(mut)]
    pub target_ata: AccountInfo<'info>,

    /// CHECK: SOL vault PDA
    #[account(mut)]
    pub sol_vault: AccountInfo<'info>,

    /// CHECK: Target wallet for SOL transfers
    #[account(mut)]
    pub target_wallet: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,

    /// CHECK: Instructions sysvar for precompile verification
    #[account(address = ix_sysvar::ID)]
    pub instructions: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    #[account(mut)]
    pub registry: Account<'info, VaultRegistry>,
    pub owner: Signer<'info>,
}

// ── State ───────────────────────────────────────────────────────────
#[account]
pub struct VaultRegistry {
    pub chip_pubkey: [u8; 64],        // 64
    pub owner_sol: Pubkey,            // 32
    pub nonce: u64,                   // 8  (active tap nonce)
    pub daily_limit: u64,             // 8
    pub daily_spend: u64,             // 8
    pub last_day: i64,                // 8
    pub frozen: bool,                 // 1
    pub bump: u8,                     // 1
    // ── Passive tap fields ──
    pub relay_authority: Pubkey,      // 32  (trusted relay signer)
    pub tap_target: Pubkey,           // 32  (where SOL goes on passive tap)
    pub tap_amount: u64,              // 8   (lamports per tap)
    pub last_counter: u32,            // 4   (HaLo chip counter — replay prevention)
    // Total: 64+32+8+8+8+8+1+1+32+32+8+4 = 206 bytes (within 280)
}

// ── Payload (active tap mode) ───────────────────────────────────────
#[derive(BorshSerialize, BorshDeserialize)]
pub struct TapPayload {
    pub program_id: Pubkey,
    pub owner_sol: Pubkey,
    pub action: u8,
    pub mint: Pubkey,
    pub amount: u64,
    pub target: Pubkey,
    pub nonce: u64,
    pub timestamp: i64,
}

// ── Errors ──────────────────────────────────────────────────────────
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