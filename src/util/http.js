export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJson(url, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    timeoutMs = 20000,
    retries = 3,
    delayMs = 1000,
    onRetry,
  } = options;

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        body,
        headers: {
          'User-Agent': 'AppStoreReviewStudio/1.0 (+https://github.com)',
          Accept: 'application/json',
          ...headers,
        },
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
        error.status = response.status;
        throw error;
      }
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        if (onRetry) onRetry({ attempt, error });
        await sleep(delayMs * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export function parseJsonSafe(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error };
  }
}

