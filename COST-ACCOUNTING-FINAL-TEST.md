# Final Cost Accounting Test

This is a controlled real-world checkout experiment for Klin's task cost accounting.

## Scenario

The checkout task implements `orderTotalCents` for an e-commerce cart:

1. Calculate subtotal.
2. Apply percentage discount.
3. Apply percentage tax to the discounted amount.
4. Round to integer cents.
5. Preserve the cart input.

A second task is a controlled failure probe: it adds regression coverage for negative tax without changing the checkout implementation. That task is intentionally expected to fail so the ledger can be checked for retry accounting.

## Commands

```bash
git fetch origin
git checkout test/real-world-cost-accounting
git reset --hard origin/test/real-world-cost-accounting
pnpm install --ignore-scripts
pnpm test:unit

pnpm run project:plan -- "Implement the checkout total calculation with discount and tax, then run the controlled negative-tax regression probe without changing checkout.js." --confirm-spend

KLIN_LIVE=1 KLIN_CONCURRENCY=1 KLIN_MAX_ATTEMPTS=2 pnpm run project:parallel -- --confirm-spend

cat .klin/ledger.json
```

The expected evidence is one ledger containing the successful checkout task plus the controlled failed/retried validation task. Compare estimated cost fields with actual usage/cost fields rather than treating the estimate as the final bill.
