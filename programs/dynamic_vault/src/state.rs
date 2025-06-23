use anchor_lang::prelude::*;

#[account]
pub struct Vault {
    pub admin: Pubkey,           // Vault admin
    pub current_bins: [i32; 2],  // Active LP bins [lower, upper]
    pub pending_rebalance_bins: [i32; 2], // Bins calculated for next rebalance
    pub last_rebalance_time: i64,
    pub last_fee_harvest_time: i64,
    pub total_fees_earned: u64,  // Track harvested fees
    pub max_fee_amount: u64,     // Maximum allowed fee accumulation
    pub bump: u8,                // PDA bump
    pub fee_token_account: Pubkey, // Token account for fee storage
    pub rebalance_threshold: u8, // Percentage threshold (e.g. 5 for 5%)
    pub min_rebalance_delay: i64, // Minimum seconds between rebalances
    pub last_price: f64,         // Last recorded price
    pub price_update_time: i64,  // Timestamp of last price update
}

impl Vault {
    pub const LEN: usize = 32 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 32 + 1 + 8 + 8 + 8;
}
