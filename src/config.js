import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const envFile = parseEnvFile(path.join(ROOT_DIR, '.env'));
const env = (key, fallback) => {
  const v = process.env[key] ?? envFile[key];
  return v === undefined || v === '' ? fallback : v;
};

const num = (key, fallback) => {
  const v = Number(env(key, fallback));
  return Number.isFinite(v) ? v : fallback;
};

export const config = {
  port: num('PORT', 8787),
  host: env('HOST', '127.0.0.1'),
  maxReviews: num('MAX_REVIEWS', 300),
  modelMaxReviews: num('MODEL_MAX_REVIEWS', 160),
  classifyBatchSize: num('CLASSIFY_BATCH_SIZE', 24),
  minFindingSupport: num('MIN_FINDING_SUPPORT', 3),
  llmTimeoutMs: num('LLM_TIMEOUT_MS', 300000),
  llmMaxRetries: num('LLM_MAX_RETRIES', 3),
  requestDelayMs: num('REQUEST_DELAY_MS', 1100),
  llm: {
    provider: env('LLM_PROVIDER', 'ollama'),
    temperature: num('LLM_TEMPERATURE', 0.2),
    ollamaBaseUrl: env('OLLAMA_BASE_URL', 'http://127.0.0.1:11434'),
    ollamaModel: env('OLLAMA_MODEL', 'DeepSeek-R1:7b'),
    ollamaNumCtx: num('OLLAMA_NUM_CTX', 16384),
    openaiBaseUrl: env('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    openaiApiKey: env('OPENAI_API_KEY', ''),
    openaiModel: env('OPENAI_MODEL', 'gpt-4o-mini'),
  },
};

export function publicConfig() {
  return {
    llmProvider: config.llm.provider,
    ollamaModel: config.llm.ollamaModel,
    openaiModel: config.llm.openaiModel,
    openaiConfigured: Boolean(config.llm.openaiApiKey),
    maxReviews: config.maxReviews,
    modelMaxReviews: config.modelMaxReviews,
    minFindingSupport: config.minFindingSupport,
  };
}
