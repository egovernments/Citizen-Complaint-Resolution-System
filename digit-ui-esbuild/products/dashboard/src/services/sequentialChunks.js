function cancellationError() {
  const error = new Error("Sequential request cancelled");
  error.name = "AbortError";
  return error;
}

function isCancelled(signal, shouldContinue) {
  return Boolean(signal?.aborted) || (shouldContinue && !shouldContinue());
}

/** Split an array into bounded chunks while preserving input order. */
export function chunkValues(values, limit) {
  const chunks = [];
  for (let offset = 0; offset < values.length; offset += limit) {
    chunks.push(values.slice(offset, offset + limit));
  }
  return chunks;
}

/**
 * Run chunks sequentially and retain both successes and failures.
 *
 * Callers own the domain-specific merge and total-failure policy. Cancellation
 * is the one shared terminal condition: once a request generation is stale, no
 * later chunk may be issued.
 */
export async function runSequentialChunks(
  chunks,
  executeChunk,
  { signal, shouldContinue } = {}
) {
  const outcomes = [];
  for (let index = 0; index < chunks.length; index += 1) {
    if (isCancelled(signal, shouldContinue)) throw cancellationError();
    const chunk = chunks[index];
    try {
      const value = await executeChunk(chunk, index);
      outcomes.push({ chunk, value, error: null });
    } catch (error) {
      if (isCancelled(signal, shouldContinue) || error?.name === "AbortError") {
        throw error?.name === "AbortError" ? error : cancellationError();
      }
      outcomes.push({ chunk, value: null, error });
    }
  }
  return outcomes;
}
