import 'dotenv/config';

const apiKey = process.env.META_API_KEY;
const model = process.env.META_MODEL ?? 'muse-spark-1.2-contributor';

if (!apiKey) {
  console.error('Missing META_API_KEY. Put it in .env');
  process.exit(1);
}

const url = 'https://api.meta.ai/v1/responses';

async function main() {
  console.log('Klin — Muse API smoke test');
  console.log(`Model: ${model}`);
  console.log('Sending a minimal request...\n');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: 'Return exactly: HELLO_KLIN',
    }),
  });

  const text = await response.text();

  console.log(`HTTP ${response.status}`);
  console.log('Raw response:');
  console.log(text);

  if (!response.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
