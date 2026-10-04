use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::{AccountMeta, Instruction}, program::invoke_signed};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

declare_id!("EsfAQom4gUDumzUNCTzMHmsssdUBd1uBuLK1CynKZp24");
pub const METEORA: Pubkey = pubkey!("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
pub const ACTIVATION_USD_MICROS: u64 = 20_000_000;
pub const INITIAL_GAS_LAMPORTS: u64 = 20_000_000;
pub const CLAIM_FEE2: [u8; 8] = [112,191,101,171,28,144,127,187];
pub const INITIALIZE_OPERATOR: [u8; 8] = [251,189,190,244,117,254,35,148];

#[program]
pub mod thicc_vault {
    use super::*;

    // Registry installation requires the program's actual upgrade authority.
    // Deployment must revoke upgrade authority before THICC advertises immutability.
    pub fn initialize_registry(ctx: Context<InitializeRegistry>, keeper: Pubkey, valuation_authority: Pubkey, solcard: Pubkey) -> Result<()> {
        require!(keeper != Pubkey::default() && valuation_authority != Pubkey::default() && solcard != Pubkey::default(), VaultError::InvalidConfig);
        let r = &mut ctx.accounts.registry;
        r.authority = ctx.accounts.authority.key(); r.keeper = keeper;
        r.valuation_authority = valuation_authority; r.solcard = solcard;
        r.bump = ctx.bumps.registry;
        Ok(())
    }

    // Quotes are immutable once registered. No update or deletion instruction exists.
    pub fn register_quote(ctx: Context<RegisterQuote>, category: u8) -> Result<()> {
        require!(category <= 2, VaultError::InvalidQuote);
        let q = &mut ctx.accounts.quote;
        q.mint = ctx.accounts.mint.key(); q.decimals = ctx.accounts.mint.decimals;
        q.category = category; q.bump = ctx.bumps.quote;
        Ok(())
    }

    // Creates one deterministic wallet/vault per launched base token.
    // The creator has no instruction to reclaim or redirect its fee rights.
    pub fn initialize_agent(ctx: Context<InitializeAgent>) -> Result<()> {
        let a = &mut ctx.accounts.agent;
        a.creator = ctx.accounts.creator.key(); a.base_mint = ctx.accounts.base_mint.key();
        a.quote_mint = ctx.accounts.quote.mint; a.pool = ctx.accounts.pool.key();
        a.keeper = ctx.accounts.registry.keeper; a.solcard = ctx.accounts.registry.solcard;
        a.cumulative_fee_usd_micros = 0; a.quote_fee_balance = 0; a.activated = false;
        a.position = Pubkey::default(); a.bump = ctx.bumps.agent;
        // This is escrowed gas funding. A bounded keeper reimbursement instruction
        // is required before the worker can spend it; a PDA cannot pay tx fees directly.
        anchor_lang::system_program::transfer(CpiContext::new(ctx.accounts.system_program.to_account_info(),anchor_lang::system_program::Transfer {from:ctx.accounts.creator.to_account_info(),to:ctx.accounts.agent.to_account_info()}),INITIAL_GAS_LAMPORTS)?;
        Ok(())
    }

    // The program constructs the fee-owner field itself. The developer cannot supply it.
    pub fn initialize_position(ctx: Context<InitializePosition>, lower_bin_id: i32, width: i32) -> Result<()> {
        require!(width > 0 && width <= 70, VaultError::InvalidRange);
        require!(ctx.accounts.agent.position == Pubkey::default(), VaultError::AlreadyBound);
        let agent_key = ctx.accounts.agent.key();
        let mut data = INITIALIZE_OPERATOR.to_vec();
        data.extend_from_slice(&lower_bin_id.to_le_bytes()); data.extend_from_slice(&width.to_le_bytes());
        data.extend_from_slice(agent_key.as_ref()); // fee_owner is permanently the agent PDA
        data.extend_from_slice(&0u64.to_le_bytes());
        let infos = vec![ctx.accounts.payer.to_account_info(),ctx.accounts.base.to_account_info(),ctx.accounts.position.to_account_info(),ctx.accounts.pool.to_account_info(),ctx.accounts.agent.to_account_info(),ctx.accounts.agent.to_account_info(),ctx.accounts.agent_token_x.to_account_info(),ctx.accounts.agent_token_x.to_account_info(),ctx.accounts.system_program.to_account_info(),ctx.accounts.event_authority.to_account_info(),ctx.accounts.meteora_program.to_account_info()];
        let metas = vec![AccountMeta::new(ctx.accounts.payer.key(),true),AccountMeta::new_readonly(ctx.accounts.base.key(),true),AccountMeta::new(ctx.accounts.position.key(),false),AccountMeta::new_readonly(ctx.accounts.pool.key(),false),AccountMeta::new_readonly(agent_key,false),AccountMeta::new_readonly(agent_key,true),AccountMeta::new_readonly(ctx.accounts.agent_token_x.key(),false),AccountMeta::new_readonly(ctx.accounts.agent_token_x.key(),false),AccountMeta::new_readonly(ctx.accounts.system_program.key(),false),AccountMeta::new_readonly(ctx.accounts.event_authority.key(),false),AccountMeta::new_readonly(METEORA,false)];
        let mint = ctx.accounts.agent.base_mint; let bump = [ctx.accounts.agent.bump]; let seeds: &[&[u8]] = &[b"agent", mint.as_ref(), &bump];
        invoke_signed(&Instruction {program_id:METEORA,accounts:metas,data}, &infos, &[seeds])?;
        ctx.accounts.agent.position = ctx.accounts.position.key();
        Ok(())
    }

    // Only the fixed Meteora position can credit the fee ledger. Arbitrary token
    // transfers and the creator's initial gas contribution never count as fees.
    // A fixed, trusted valuation authority signs fresh USD attestations. This
    // trust dependency is explicit; it must be operated independently of creators.
    pub fn claim_fees<'info>(ctx: Context<'_, '_, '_, 'info, ClaimFees<'info>>, min_bin_id: i32, max_bin_id: i32, quote_usd_micros: u64, price_time: i64, confidence_bps: u16) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(quote_usd_micros > 0 && price_time <= now && now-price_time <= 60 && confidence_bps <= 100, VaultError::StalePrice);
        require!(max_bin_id >= min_bin_id && (max_bin_id as i64-min_bin_id as i64) < 70, VaultError::InvalidRange);
        let before = ctx.accounts.quote_fees.amount;
        let agent_key = ctx.accounts.agent.key();
        let mut data = CLAIM_FEE2.to_vec(); data.extend_from_slice(&min_bin_id.to_le_bytes()); data.extend_from_slice(&max_bin_id.to_le_bytes()); data.extend_from_slice(&0u32.to_le_bytes());
        let mut infos = vec![ctx.accounts.pool.to_account_info(),ctx.accounts.position.to_account_info(),ctx.accounts.agent.to_account_info(),ctx.accounts.reserve_x.to_account_info(),ctx.accounts.reserve_y.to_account_info(),ctx.accounts.base_fees.to_account_info(),ctx.accounts.quote_fees.to_account_info(),ctx.accounts.base_mint.to_account_info(),ctx.accounts.quote_mint.to_account_info(),ctx.accounts.token_program_x.to_account_info(),ctx.accounts.token_program_y.to_account_info(),ctx.accounts.memo_program.to_account_info(),ctx.accounts.event_authority.to_account_info(),ctx.accounts.meteora_program.to_account_info()];
        let mut metas = vec![AccountMeta::new(ctx.accounts.pool.key(),false),AccountMeta::new(ctx.accounts.position.key(),false),AccountMeta::new_readonly(agent_key,true),AccountMeta::new(ctx.accounts.reserve_x.key(),false),AccountMeta::new(ctx.accounts.reserve_y.key(),false),AccountMeta::new(ctx.accounts.base_fees.key(),false),AccountMeta::new(ctx.accounts.quote_fees.key(),false),AccountMeta::new_readonly(ctx.accounts.base_mint.key(),false),AccountMeta::new_readonly(ctx.accounts.quote_mint.key(),false),AccountMeta::new_readonly(ctx.accounts.token_program_x.key(),false),AccountMeta::new_readonly(ctx.accounts.token_program_y.key(),false),AccountMeta::new_readonly(ctx.accounts.memo_program.key(),false),AccountMeta::new_readonly(ctx.accounts.event_authority.key(),false),AccountMeta::new_readonly(METEORA,false)];
        for account in ctx.remaining_accounts { require_keys_eq!(*account.owner,METEORA,VaultError::InvalidAccount); infos.push(account.clone()); metas.push(AccountMeta::new(*account.key,false)); }
        let mint = ctx.accounts.agent.base_mint; let bump = [ctx.accounts.agent.bump]; let seeds: &[&[u8]] = &[b"agent", mint.as_ref(), &bump];
        invoke_signed(&Instruction {program_id:METEORA,accounts:metas,data}, &infos, &[seeds])?;
        ctx.accounts.quote_fees.reload()?;
        let earned = ctx.accounts.quote_fees.amount.checked_sub(before).ok_or(VaultError::Arithmetic)?;
        let usd = fee_value(earned,quote_usd_micros,ctx.accounts.quote.decimals)?;
        let a = &mut ctx.accounts.agent;
        a.quote_fee_balance = a.quote_fee_balance.checked_add(earned).ok_or(VaultError::Arithmetic)?;
        a.cumulative_fee_usd_micros = a.cumulative_fee_usd_micros.checked_add(usd).ok_or(VaultError::Arithmetic)?;
        if a.cumulative_fee_usd_micros >= ACTIVATION_USD_MICROS { a.activated = true; }
        emit!(FeesClaimed {agent:agent_key,quote_amount:earned,usd_micros:usd,activated:a.activated});
        Ok(())
    }
}

fn fee_value(amount:u64,price:u64,decimals:u8)->Result<u64>{require!(decimals<=18,VaultError::Arithmetic);let value=(amount as u128).checked_mul(price as u128).ok_or(VaultError::Arithmetic)?/10u128.pow(decimals as u32);u64::try_from(value).map_err(|_|error!(VaultError::Arithmetic))}

#[derive(Accounts)]
pub struct InitializeRegistry<'info>{
    #[account(mut)] pub authority:Signer<'info>,
    #[account(init,payer=authority,space=8+Registry::INIT_SPACE,seeds=[b"registry"],bump)] pub registry:Account<'info,Registry>,
    #[account(constraint=program.programdata_address()?==Some(program_data.key()) @ VaultError::InvalidAccount)] pub program:Program<'info,ThiccVault>,
    #[account(constraint=program_data.upgrade_authority_address==Some(authority.key()) @ VaultError::Unauthorized)] pub program_data:Account<'info,ProgramData>,
    pub system_program:Program<'info,System>,
}
use crate::program::ThiccVault;
#[derive(Accounts)]
pub struct RegisterQuote<'info>{
    #[account(mut)] pub authority:Signer<'info>,
    #[account(seeds=[b"registry"],bump=registry.bump,has_one=authority)] pub registry:Account<'info,Registry>,
    pub mint:InterfaceAccount<'info,Mint>,
    #[account(init,payer=authority,space=8+QuoteConfig::INIT_SPACE,seeds=[b"quote",mint.key().as_ref()],bump)] pub quote:Account<'info,QuoteConfig>,
    pub system_program:Program<'info,System>,
}
#[derive(Accounts)]
pub struct InitializeAgent<'info>{
    #[account(mut)] pub creator:Signer<'info>,
    #[account(seeds=[b"registry"],bump=registry.bump)] pub registry:Account<'info,Registry>,
    pub base_mint:InterfaceAccount<'info,Mint>,
    #[account(seeds=[b"quote",quote.mint.as_ref()],bump=quote.bump)] pub quote:Account<'info,QuoteConfig>,
    /// CHECK: fixed Meteora owner; pool/mint relation is enforced by the position CPI.
    #[account(owner=METEORA)] pub pool:UncheckedAccount<'info>,
    #[account(init,payer=creator,space=8+AgentVault::INIT_SPACE,seeds=[b"agent",base_mint.key().as_ref()],bump)] pub agent:Account<'info,AgentVault>,
    pub system_program:Program<'info,System>,
}
#[derive(Accounts)]
pub struct InitializePosition<'info>{
    #[account(mut)] pub payer:Signer<'info>,
    pub base:Signer<'info>,
    #[account(mut,seeds=[b"agent",agent.base_mint.as_ref()],bump=agent.bump,has_one=pool)] pub agent:Account<'info,AgentVault>,
    /// CHECK: initialized and derived by Meteora CPI.
    #[account(mut)] pub position:UncheckedAccount<'info>,
    /// CHECK: address is bound by agent.has_one and owner checked.
    #[account(owner=METEORA)] pub pool:UncheckedAccount<'info>,
    #[account(constraint=agent_token_x.owner==agent.key(),constraint=agent_token_x.mint==agent.base_mint)] pub agent_token_x:InterfaceAccount<'info,TokenAccount>,
    /// CHECK: Meteora event authority PDA validated by address derivation.
    #[account(seeds=[b"__event_authority"],bump,seeds::program=METEORA)] pub event_authority:UncheckedAccount<'info>,
    /// CHECK: fixed executable program.
    #[account(address=METEORA,executable)] pub meteora_program:UncheckedAccount<'info>,
    pub system_program:Program<'info,System>,
}
#[derive(Accounts)]
pub struct ClaimFees<'info>{
    #[account(seeds=[b"registry"],bump=registry.bump,has_one=valuation_authority)] pub registry:Account<'info,Registry>,
    pub valuation_authority:Signer<'info>,
    #[account(mut,seeds=[b"agent",agent.base_mint.as_ref()],bump=agent.bump,has_one=pool,has_one=position,has_one=base_mint,has_one=quote_mint)] pub agent:Account<'info,AgentVault>,
    #[account(seeds=[b"quote",quote_mint.key().as_ref()],bump=quote.bump)] pub quote:Account<'info,QuoteConfig>,
    /// CHECK: fixed pool and Meteora ownership.
    #[account(mut,owner=METEORA)] pub pool:UncheckedAccount<'info>,
    /// CHECK: position bound at initialization and Meteora checks fee authority.
    #[account(mut,owner=METEORA)] pub position:UncheckedAccount<'info>,
    /// CHECK: Meteora validates pool reserve relation in CPI.
    #[account(mut)] pub reserve_x:UncheckedAccount<'info>,
    /// CHECK: Meteora validates pool reserve relation in CPI.
    #[account(mut)] pub reserve_y:UncheckedAccount<'info>,
    #[account(mut,token::mint=base_mint,token::authority=agent)] pub base_fees:InterfaceAccount<'info,TokenAccount>,
    #[account(mut,token::mint=quote_mint,token::authority=agent)] pub quote_fees:InterfaceAccount<'info,TokenAccount>,
    pub base_mint:InterfaceAccount<'info,Mint>,pub quote_mint:InterfaceAccount<'info,Mint>,
    pub token_program_x:Interface<'info,TokenInterface>,pub token_program_y:Interface<'info,TokenInterface>,
    /// CHECK: fixed memo program address.
    #[account(address=pubkey!("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"))] pub memo_program:UncheckedAccount<'info>,
    /// CHECK: fixed Meteora event PDA.
    #[account(seeds=[b"__event_authority"],bump,seeds::program=METEORA)] pub event_authority:UncheckedAccount<'info>,
    /// CHECK: fixed executable Meteora program.
    #[account(address=METEORA,executable)] pub meteora_program:UncheckedAccount<'info>,
}
#[account] #[derive(InitSpace)] pub struct Registry{pub authority:Pubkey,pub keeper:Pubkey,pub valuation_authority:Pubkey,pub solcard:Pubkey,pub bump:u8}
#[account] #[derive(InitSpace)] pub struct QuoteConfig{pub mint:Pubkey,pub decimals:u8,pub category:u8,pub bump:u8}
#[account] #[derive(InitSpace)] pub struct AgentVault{pub creator:Pubkey,pub base_mint:Pubkey,pub quote_mint:Pubkey,pub pool:Pubkey,pub position:Pubkey,pub keeper:Pubkey,pub solcard:Pubkey,pub cumulative_fee_usd_micros:u64,pub quote_fee_balance:u64,pub activated:bool,pub bump:u8}
#[event] pub struct FeesClaimed{pub agent:Pubkey,pub quote_amount:u64,pub usd_micros:u64,pub activated:bool}
#[error_code] pub enum VaultError{#[msg("Invalid immutable configuration")]InvalidConfig,#[msg("Quote not allowed")]InvalidQuote,#[msg("Arithmetic overflow")]Arithmetic,#[msg("Invalid bin range")]InvalidRange,#[msg("Position already bound")]AlreadyBound,#[msg("Stale or unreliable USD valuation")]StalePrice,#[msg("Invalid account")]InvalidAccount,#[msg("Unauthorized")]Unauthorized}

#[cfg(test)] mod tests{use super::*;#[test]fn fee_valuation_uses_integer_micros(){assert_eq!(fee_value(10_000_000,2_000_000,6).unwrap(),ACTIVATION_USD_MICROS);assert_eq!(fee_value(9_999_999,2_000_000,6).unwrap(),19_999_998);}#[test]fn overflow_and_bad_decimals_fail(){assert!(fee_value(u64::MAX,u64::MAX,0).is_err());assert!(fee_value(1,1,19).is_err());}}
