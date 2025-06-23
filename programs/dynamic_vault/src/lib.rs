use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::Clock;
use anchor_spl::token::TokenAccount;
use crate::state::Vault;
// use meteora_dlmm;

#[error_code]
pub enum ErrorCode {
    #[msg("Threshold must be between 1-100")]
    InvalidThreshold,
    #[msg("Invalid parameter value")]
    InvalidParameter,
    #[msg("Fee calculation overflow")]
    FeeOverflow,
    #[msg("Maximum fee amount exceeded")]
    MaxFeeExceeded,
    #[msg("Rebalance too frequent")]
    RebalanceTooFrequent,
    #[msg("Invalid bin range")]
    InvalidBins,
    #[msg("Price data is too stale")]
    StalePrice,
    #[msg("Invalid share percentage")]
    InvalidSharePercentage,
}

declare_id!("5WsnuvmE8uRrhoRQeEEo8wJBqhh4NrMcmADVqhjGD544");

#[program]
pub mod dynamic_vault {
    use super::*;

    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        fee_token_account: Pubkey,
        rebalance_threshold: u8,
        max_fee_amount: u64,
        min_rebalance_delay: i64,
    ) -> Result<()> {
        require!(rebalance_threshold > 0 && rebalance_threshold <= 100, ErrorCode::InvalidThreshold);
        require!(min_rebalance_delay > 0, ErrorCode::InvalidParameter);
        
        ctx.accounts.vault.fee_token_account = fee_token_account;
        ctx.accounts.vault.rebalance_threshold = rebalance_threshold;
        ctx.accounts.vault.admin = *ctx.accounts.admin.key;
        ctx.accounts.vault.current_bins = [0, 0];  // Default bins
        ctx.accounts.vault.bump = *ctx.bumps.get("vault").unwrap();
        ctx.accounts.vault.max_fee_amount = max_fee_amount;
        ctx.accounts.vault.min_rebalance_delay = min_rebalance_delay;
        ctx.accounts.vault.last_fee_harvest_time = 0;
        ctx.accounts.vault.last_rebalance_time = 0;
        ctx.accounts.vault.total_fees_earned = 0;
        Ok(())
    }

    pub fn deposit_liquidity(
        ctx: Context<DepositLiquidity>,
        amount: u64,
        bins: [i32; 2],
    ) -> Result<()> {
        meteora_dlmm::cpi::add_liquidity(
            CpiContext::new(
                ctx.accounts.dlmm_program.to_account_info(),
                meteora_dlmm::cpi::accounts::AddLiquidity {
                    pool: ctx.accounts.pool.clone(),
                    position: ctx.accounts.position.clone(),
                    user_token_a: ctx.accounts.user_token_a.clone(),
                    user_token_b: ctx.accounts.user_token_b.clone(),
                    // ... other required DLMM accounts
                },
            ),
            amount,
            bins,
        )?;

        ctx.accounts.vault.current_bins = bins;
        Ok(())
    }

    pub fn harvest_fees(ctx: Context<HarvestFees>) -> Result<()> {
        let clock = Clock::get()?;
        let vault = &mut ctx.accounts.vault;

        let cpi_ctx = CpiContext::new(
            ctx.accounts.dlmm_program.to_account_info(),
            meteora_dlmm::cpi::accounts::HarvestFee {
                pool: ctx.accounts.pool.clone(),
                position: ctx.accounts.position.clone(),
                fee_token_account: vault.fee_token_account.clone(),
                token_program: ctx.accounts.token_program.clone(),
            },
        );
        let fee_amount = meteora_dlmm::cpi::harvest_fee(cpi_ctx)?;

        // Check fee overflow protection
        require!(
            vault.total_fees_earned.checked_add(fee_amount).is_some(),
            ErrorCode::FeeOverflow
        );
        require!(
            vault.total_fees_earned + fee_amount <= vault.max_fee_amount,
            ErrorCode::MaxFeeExceeded
        );
        
        vault.total_fees_earned = vault.total_fees_earned.checked_add(fee_amount).unwrap();
        vault.last_fee_harvest_time = clock.unix_timestamp;
        Ok(())
    }

    fn calculate_new_bins(old_price: f64, new_price: f64, threshold: u8) -> [i32; 2] {
        let mid_price = (old_price + new_price) / 2.0;
        let spread = (threshold as f64) / 100.0;
        [
            (mid_price * (1.0 - spread)).round() as i32,
            (mid_price * (1.0 + spread)).round() as i32
        ]
    }

    pub fn check_price(ctx: Context<CheckPrice>, new_price: f64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let clock = Clock::get()?;
        
        // Check price staleness (max 30 seconds old)
        require!(
            clock.unix_timestamp - vault.price_update_time < 30,
            ErrorCode::StalePrice
        );
        
        // Calculate price delta percentage
        let price_delta = ((new_price - vault.last_price).abs() / vault.last_price) * 100.0;
        
        // Trigger rebalance if threshold exceeded
        if price_delta > vault.rebalance_threshold as f64 {
            vault.pending_rebalance_bins = Self::calculate_new_bins(
                vault.last_price,
                new_price,
                vault.rebalance_threshold
            );
        }
        
        vault.last_price = new_price;
        vault.price_update_time = clock.unix_timestamp;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, share: u64) -> Result<()> {
        require!(share > 0 && share <= 100, ErrorCode::InvalidSharePercentage);
        
        // Remove liquidity from current bins
        meteora_dlmm::cpi::remove_liquidity(
            CpiContext::new(
                ctx.accounts.dlmm_program.to_account_info(),
                meteora_dlmm::cpi::accounts::RemoveLiquidity {
                    pool: ctx.accounts.pool.clone(),
                    position: ctx.accounts.position.clone(),
                    lb_pair: ctx.accounts.lb_pair.clone(),
                    bin_array_lower: ctx.accounts.bin_array_lower.clone(),
                    bin_array_upper: ctx.accounts.bin_array_upper.clone(),
                    sender: ctx.accounts.vault.to_account_info(),
                    token_x: ctx.accounts.vault_token_a.clone(),
                    token_y: ctx.accounts.vault_token_b.clone(),
                    token_program: ctx.accounts.token_program.clone(),
                },
            ),
            ctx.accounts.position.liquidity * share / 100,
            ctx.accounts.vault.current_bins
        )?;

        // Transfer tokens to user (implementation depends on token program)
        // Would need additional token transfer CPI calls here
        
        Ok(())
    }

    pub fn rebalance(ctx: Context<Rebalance>) -> Result<()> {
        let new_bins = ctx.accounts.vault.pending_rebalance_bins;
        require!(new_bins[0] != 0 && new_bins[1] != 0, ErrorCode::InvalidBins);
        let clock = Clock::get()?;
        let vault = &mut ctx.accounts.vault;

        // Validate bin range
        require!(new_bins[0] < new_bins[1], ErrorCode::InvalidBins);

        // Check rebalance frequency
        require!(
            clock.unix_timestamp - vault.last_rebalance_time > vault.min_rebalance_delay,
            ErrorCode::RebalanceTooFrequent
        );

        // Check price staleness (max 30 seconds old)
        require!(
            clock.unix_timestamp - vault.price_update_time < 30,
            ErrorCode::StalePrice
        );

        // 1. Withdraw from current bins
        meteora_dlmm::cpi::remove_liquidity(
            CpiContext::new(
                ctx.accounts.dlmm_program.to_account_info(),
                meteora_dlmm::cpi::accounts::RemoveLiquidity {
                    pool: ctx.accounts.pool.clone(),
                    position: ctx.accounts.position.clone(),
                    // ... other required DLMM accounts
                },
            ),
            vault.current_bins,
        )?;

        // 2. Deposit into new bins
        meteora_dlmm::cpi::add_liquidity(
            CpiContext::new(
                ctx.accounts.dlmm_program.to_account_info(),
                meteora_dlmm::cpi::accounts::AddLiquidity {
                    pool: ctx.accounts.pool.clone(),
                    position: ctx.accounts.position.clone(),
                    user_token_a: ctx.accounts.user_token_a.clone(),
                    user_token_b: ctx.accounts.user_token_b.clone(),
                    // ... other required DLMM accounts
                },
            ),
            ctx.accounts.token_amount,
            new_bins,
        )?;

        // 3. Update vault state
        vault.current_bins = new_bins;
        vault.pending_rebalance_bins = [0, 0];
        vault.last_rebalance_time = clock.unix_timestamp;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Rebalance<'info> {
    #[account(mut, has_one = admin)]
    pub vault: Account<'info, Vault>,
    pub admin: Signer<'info>,

    // DLMM Accounts
    pub dlmm_program: Program<'info, meteora_dlmm::program::MeteoraDlmm>,
    #[account(mut)]
    pub pool: AccountInfo<'info>,
    #[account(mut)]
    pub position: AccountInfo<'info>,
    #[account(mut)]
    pub user_token_a: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_b: Account<'info, TokenAccount>,
    #[account(mut)]
    pub lb_pair: AccountInfo<'info>,
    #[account(mut)]
    pub bin_array_lower: AccountInfo<'info>,
    #[account(mut)]
    pub bin_array_upper: AccountInfo<'info>,
    pub token_amount: u64,  // Not an account, just instruction data
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct DepositLiquidity<'info> {
    #[account(mut, has_one = admin)]
    pub vault: Account<'info, Vault>,
    pub admin: Signer<'info>,

    // DLMM Accounts
    pub dlmm_program: Program<'info, meteora_dlmm::program::MeteoraDlmm>,
    #[account(mut)]
    pub pool: AccountInfo<'info>,
    #[account(mut)]
    pub position: AccountInfo<'info>,
    #[account(mut)]
    pub user_token_a: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_b: Account<'info, TokenAccount>,
    // ... other required DLMM accounts
}

#[derive(Accounts)]
pub struct HarvestFees<'info> {
    #[account(mut, has_one = admin)]
    pub vault: Account<'info, Vault>,
    pub admin: Signer<'info>,

    // DLMM Accounts
    pub dlmm_program: Program<'info, meteora_dlmm::program::MeteoraDlmm>,
    #[account(mut)]
    pub pool: AccountInfo<'info>,
    #[account(mut)]
    pub position: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CheckPrice<'info> {
    #[account(mut, has_one = admin)]
    pub vault: Account<'info, Vault>,
    pub admin: Signer<'info>,
    /// CHECK: Pyth price account
    pub price_account: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, has_one = admin)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub admin: Signer<'info>,

    // DLMM Accounts
    pub dlmm_program: Program<'info, meteora_dlmm::program::MeteoraDlmm>,
    #[account(mut)]
    pub pool: AccountInfo<'info>,
    #[account(mut)]
    pub position: AccountInfo<'info>,
    #[account(mut)]
    pub lb_pair: AccountInfo<'info>,
    
    // Token Accounts
    #[account(mut)]
    pub user_token_a: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_b: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token_a: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token_b: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(init, payer = admin, space = 8 + Vault::LEN, seeds = [b"vault", admin.key.as_ref()], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}
