import test from 'node:test';
import assert from 'node:assert/strict';
import { decideRetry } from './retry-policy.js';

test('retries bounded verification failures', () => {
  assert.equal(decideRetry({ attempts: 1, maxAttempts: 2, error: new Error('tests failed') }).retry, true);
});

test('does not retry after the attempt limit', () => {
  assert.equal(decideRetry({ attempts: 2, maxAttempts: 2, error: new Error('tests failed') }).retry, false);
});

test('does not retry unrelated failures', () => {
  assert.equal(decideRetry({ attempts: 1, maxAttempts: 2, error: new Error('API authentication failed') }).retry, false);
});
