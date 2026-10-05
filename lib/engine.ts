/** The model proposes; this deterministic policy boundary decides. No signing keys here. */
export type Market = { price: number; volatility: number; buyShare: number; depthUsd: number; ageSeconds: number; priceMovePct: number };
export type Policy = { reservePct: number; maxRebalancePct: number; maxSlippageBps: number; compoundPct: number; computePct: number; cooldownSeconds: number };
export type Proposal = { action: "hold" | "tighten" | "widen"; rangePct: number; rebalancePct: number; slippageBps: number; reservePct: number; reason: string };
export const DEFAULT_POLICY: Policy = { reservePct: 20, maxRebalancePct: 15, maxSlippageBps: 50, compoundPct: 55, computePct: 10, cooldownSeconds: 300 };
export function validatePolicy(p: Policy): string[] {
 const errors: string[] = [];
 if (![p.reservePct,p.maxRebalancePct,p.maxSlippageBps,p.compoundPct,p.computePct,p.cooldownSeconds].every(Number.isFinite)) return ["All policy values must be finite numbers."];
 if (p.reservePct < 20 || p.reservePct > 80) errors.push("Reserve must be between 20% and 80%.");
 if (p.maxRebalancePct <= 0 || p.maxRebalancePct > 15) errors.push("A rebalance may move at most 15% of liquidity.");
 if (p.maxSlippageBps <= 0 || p.maxSlippageBps > 50) errors.push("Slippage is capped at 50 bps.");
 if (p.compoundPct<0||p.computePct<0||p.compoundPct+p.computePct>70) errors.push("Compute and compounding must preserve 20% reserves and 10% buyback.");
 if (p.cooldownSeconds < 300) errors.push("Rebalances require a five-minute cooldown.");
 return errors;
}
export function validateProposal(proposal: Proposal, market: Market, policy: Policy, elapsedSeconds: number): string[] {
 const errors = validatePolicy(policy);
 if (![market.price,market.volatility,market.buyShare,market.depthUsd,market.ageSeconds,market.priceMovePct,elapsedSeconds].every(Number.isFinite) || market.price <= 0 || market.volatility < 0 || market.buyShare < 0 || market.buyShare > 100 || market.depthUsd < 0 || market.ageSeconds < 0 || elapsedSeconds < 0) errors.push("Invalid market snapshot.");
 if (market.ageSeconds > 60) errors.push("Market data is stale.");
 if (Math.abs(market.priceMovePct) >= 15) errors.push("Circuit breaker: price moved 15% or more.");
 if (market.depthUsd < 10000) errors.push("Pool depth is below the $10,000 safety floor.");
 if (![proposal.rangePct,proposal.rebalancePct,proposal.slippageBps,proposal.reservePct].every(Number.isFinite)) errors.push("Proposal contains invalid numbers.");
 if (!["hold","tighten","widen"].includes(proposal.action)) errors.push("Unsupported action.");
 if (proposal.rangePct < 2 || proposal.rangePct > 30) errors.push("Range width must be 2–30%.");
 if (proposal.rebalancePct < 0 || proposal.rebalancePct > policy.maxRebalancePct) errors.push("Rebalance exceeds movement limit.");
 if (proposal.reservePct < policy.reservePct || proposal.reservePct > 100) errors.push("Reserve floor would be breached.");
 if (proposal.slippageBps < 0 || proposal.slippageBps > policy.maxSlippageBps) errors.push("Slippage limit exceeded.");
 if (proposal.action !== "hold" && elapsedSeconds < policy.cooldownSeconds) errors.push("Rebalance cooldown is still active.");
 return errors;
}
export function propose(market: Market, policy: Policy): Proposal {
 const volatile = market.volatility > 5;
 return {action: volatile ? "widen" : "tighten", rangePct: volatile ? 18 : 6, rebalancePct: Math.min(10,policy.maxRebalancePct), slippageBps: Math.min(30,policy.maxSlippageBps), reservePct: policy.reservePct, reason: volatile ? "Elevated volatility: widen the active range and preserve the reserve." : "Stable flow: concentrate liquidity around the active price."};
}
export function allocateFees(feesUsd: number, policy: Policy) {
 if (!Number.isFinite(feesUsd) || feesUsd < 0 || validatePolicy(policy).length) throw new Error("Invalid fee allocation.");
 const totalCents = Math.floor(feesUsd * 100);
 const compoundCents = Math.floor(totalCents * policy.compoundPct / 100);
 const computeCents = Math.floor(totalCents * policy.computePct / 100);
 const buybackBurnCents = Math.floor(totalCents * 10 / 100);
 return {compoundUsd: compoundCents / 100, computeUsd: computeCents / 100, buybackBurnUsd: buybackBurnCents / 100, treasuryUsd: (totalCents-compoundCents-computeCents-buybackBurnCents)/100};
}
