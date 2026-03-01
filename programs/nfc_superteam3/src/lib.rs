use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::invoke_signed,
    system_instruction,
};
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use borsh::{BorshDeserialize, BorshSerialize};
use sha3::{Keccak256, Digest};
use libsecp256k1::{recover, Message, RecoveryId, Signature};

declare_id!("56vaZuVGs7oLE2s2JxYBdfTaBQg9BYeDdhkp9MxC2Q1K"); // Will update after deployment if new address is generated

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

        // Signature verification
        let mut hasher = Keccak256::new();
        hasher.update(&payload_bytes);
        let hash = hasher.finalize();
        let message = Message::parse_slice(&hash).map_err(|_| VaultError::SignatureVerificationFailed)?;
        let rec_id = RecoveryId::parse(recovery_id).map_err(|_| VaultError::SignatureVerificationFailed)?;
        let sig = Signature::parse_standard_slice(&signature).map_err(|_| VaultError::SignatureVerificationFailed)?;
        let recovered = recover(&message, &sig, &rec_id).map_err(|_| VaultError::SignatureVerificationFailed)?;
        let recovered_bytes = recovered.serialize();
        require!(
            &recovered_bytes[..64] == &registry.chip_pubkey[..],
            VaultError::SignatureVerificationFailed
        );

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
    let registry = &ctx.accounts.registry;
    let seeds = &[
        b"vault" as &[u8],
        registry.owner_sol.as_ref(),
        &registry.chip_pubkey[..32],
        &registry.chip_pubkey[32..],
        &[registry.bump],
    ];
    let signer = &[&seeds[..]];

    invoke_signed(
        &system_instruction::transfer(
            ctx.accounts.sol_vault.key,
            ctx.accounts.target_wallet.key,
            amount,
        ),
        &[
            ctx.accounts.sol_vault.to_account_info(),
            ctx.accounts.target_wallet.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        signer,
    )?;
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

    /// CHECK: This is a token account validated in instruction logic
    #[account(mut)]
    pub vault_ata: AccountInfo<'info>,

    /// CHECK: This is a token account validated in instruction logic
    #[account(mut)]
    pub target_ata: AccountInfo<'info>,

    #[account(mut)]
    pub sol_vault: SystemAccount<'info>,

    #[account(mut)]
    pub target_wallet: SystemAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
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