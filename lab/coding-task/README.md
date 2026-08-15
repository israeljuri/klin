# Klin Coding Task Fixture

This fixture is intentionally small enough to run cheaply but structured enough to test the proposed coding workflow.

## Task

Implement `applyDiscount` in `src/pricing.ts`.

Requirements:

1. A percentage discount is represented as a number from 0 to 100.
2. Reject negative discounts and discounts above 100.
3. Preserve the existing currency precision behavior.
4. A 100% discount produces a zero total.
5. Do not mutate the input cart.
6. Existing tests must continue to pass.
7. Add tests for the new behavior.

The model should return a unified git diff only. Do not return complete files unless the patch requires a new file.
