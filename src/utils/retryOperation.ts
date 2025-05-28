/**
 * Retries an asynchronous operation up to a maximum number of attempts.
 * Optionally executes a callback on each error before retrying (e.g., to send SSE events).
 *
 * @template T - The return type of the operation.
 * @param {() => Promise<T>} operation - The asynchronous operation to retry.
 * @param {number} [maxRetries=2] - Maximum number of retries.
 * @param {(err: any, attempt: number, maxRetries: number) => Promise<void> | void} [onError] - Optional callback executed on each error before retrying.
 * @returns {Promise<T>} - The result of the operation if successful.
 * @throws {any} - The last error if all retries fail.
 */
export async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 2,
  onError?: (
    err: any,
    attempt: number,
    maxRetries: number
  ) => Promise<void> | void
): Promise<T> {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      return await operation();
    } catch (err) {
      if (onError) {
        await onError(err, attempt, maxRetries);
      }
      if (attempt === maxRetries) {
        throw err;
      }
      attempt++;
    }
  }
  throw new Error("Unreachable code in retryOperation");
}
