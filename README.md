# Klin

Klin is a controlled experiment for measuring Muse Spark 1.2 Contributor API usage, token accounting, prompt caching, and eventually the logic-first coding workflow.

## Cost estimates vs. actual cost

Klin can estimate the expected cost of a task before execution. **The estimate is not the final cost.**

After the task runs, Klin records the model's actual returned token usage and resulting cost in the ledger. The final recorded cost can therefore be different from the estimate.

In short:

- **Estimate:** what Klin predicts the task will cost before it runs.
- **Actual cost:** what the model usage shows the task actually cost after it runs.

Use the estimate for planning and budget decisions; use the ledger's recorded usage/cost as the source of truth after execution.

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
