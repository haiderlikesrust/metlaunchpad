# One-time THICC test-fee recovery

This server-only command is pinned to the owner's requested $600 recovery:

- Token: `3QEbHMK6ceYevtaCdLmBQMJgcPb9PJQpgyFBP6f6x6Rg`
- Recipient: `3eZ3dsnUHp7aHrAA5FZPuiy8yXSq5wPuwNVzvn1gQzE4`
- Amount: $600 worth of native SOL at a fresh Pump SOL/USD quote, rounded down to lamports. This is not a guaranteed $600 cash payout; SOL's USD price moves.

1. Let any already-submitted transactions finish. Set `EXECUTION_PAUSED=true` in Dokploy and redeploy **web and worker** using this commit. This prevents new automatic transfers, including retries; already-broadcast transactions can still settle.
2. Open the **web container terminal** in Dokploy. Preview:

   ```sh
   node /app/deploy/recover-test-fees.bundle.cjs
   ```

3. Check the printed source, recipient, SOL amount and remaining balance. To execute the authorized recovery:

   ```sh
   node /app/deploy/recover-test-fees.bundle.cjs --send
   ```

4. Rerun exactly the same `--send` command until it reports `finalized`. It reuses the persisted signed transaction and will not send a second payment. `submitted` is not confirmation. For `failed` or `expired`, funds are released in the ledger, and a second transfer is **not** automatically created.

If an earlier transaction is unresolved, **keep execution paused** and run:

```sh
node /app/deploy/recover-test-fees.bundle.cjs --reconcile
```

This backs up the database and checks existing signatures against finalized RPC history. It updates their stored results without decrypting a key, broadcasting transactions, starting jobs or resuming the worker. A missing transaction remains pending until its blockhash has expired at finalized height and a second history check also finds no signature. A successful transaction requires its finalized receipt. When `unresolved` is `0`, rerun the preview. Fee-claim receipts are preserved for the regular fee ingester; this command does not turn newly observed claims into an extra spendable allocation.

The command backs up the SQLite database under `/data/backups`, uses the configured encrypted key without printing/exporting it, simulates a native SOL transfer, preserves 0.02 SOL plus the network fee, records the ledger debit and public recovery event, and leaves this agent on `recovery_hold`. No LP position is transferred, unlocked or withdrawn. Nothing runs merely by deploying this command.

Never-signed SOL funding/buyback/gas jobs may be cancelled and their reservations returned to the fee ledger before recovery. Already-started jobs, unresolved signed transactions and shared funding requests block recovery; do not delete their records to force it through. If the available wallet SOL or earned-fee ledger is insufficient, no transfer is prepared. Already-spent or locked assets cannot fund this recovery.

After finalization, `EXECUTION_PAUSED=false` can restore other agents. This test agent remains paused to prevent spending against the recovered allocations. Resuming it requires an explicit accounting review; do not edit its status casually. Preserve the database and encryption key backups.
