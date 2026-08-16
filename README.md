# Klin

Klin is a controlled experiment for measuring Muse Spark 1.2 Contributor API usage, token accounting, prompt caching, and eventually the logic-first coding workflow.

## Cost estimates vs. actual cost

Klin calculates an **estimate before execution** and records the **actual model cost after execution**. They are intentionally separate because they can differ.

- **Estimate:** a planning-time prediction based on the expected input-token usage and configured input rate. It is used for budget reservation.
- **Actual cost:** calculated after the model responds from the returned input and output token usage and configured rates.
- **Ledger:** stores both `estimated_cost_usd` and `actual_cost_usd` for each executed task. Actual cost is the source of truth for money spent.

So the flow is:

**estimate → approve/reserve budget → execute → receive actual usage → calculate actual cost → record both.**

Use the estimate for planning and budget decisions; use actual cost for reporting and accounting.

## Local setup

```bash
git clone https://github.com/israeljuri/klin.git
cd klin
npm install
cp .env.example .env
```

Put your Meta Model API key in `.env`:

```env
META_API_KEY=...
META_MODEL=muse-spark-1.2-contributor
```

**Never commit `.env` or your API key.**

The first experiment script will be added after the API request format is verified against the current Meta Model API documentation.
