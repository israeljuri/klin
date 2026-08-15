export type RetryDecision = {
  retry: boolean;
  reason: string;
  max_attempts: number;
};

export type RetryPolicyOptions = {
  attempts: number;
  maxAttempts?: number;
};

export function decideRetry(options: RetryPolicyOptions & { error: unknown }): RetryDecision {
  const max_attempts = options.maxAttempts ?? 2;
  const message = options.error instanceof Error ? options.error.message : String(options.error);
  const retryable = /test|assert|verification|diff|compile|syntax|type|failed/i.test(message);
  return {
    retry: options.attempts < max_attempts && retryable,
    reason: retryable ? 'verification-related failure may be fixable by another implementation attempt' : 'failure is not classified as an implementation-verification failure',
    max_attempts,
  };
}
