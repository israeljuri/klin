# Klin

Klin is a controlled experiment for measuring Muse Spark 1.2 Contributor API usage, token accounting, prompt caching, and eventually the logic-first coding workflow.

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
