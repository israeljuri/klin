# Fixture Architecture

The pricing layer must remain a pure calculation layer.

- `src/cart.ts` owns cart data structures and subtotal calculation.
- `src/pricing.ts` owns pricing transformations.
- Pricing functions must not mutate cart objects.
- Money is represented as integer cents.
- Tests use Node's built-in test runner.
- Keep the public API small and avoid adding dependencies.

For the controlled experiment, provide only the smallest patch needed to satisfy the task. Do not refactor unrelated code.
