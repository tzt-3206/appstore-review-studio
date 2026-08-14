import { loadPromptTemplates, buildMessages } from './prompts.js';
import { createProvider } from './provider.js';
import { createMockProvider } from './mock.js';
import { ModelUnavailableError } from './errors.js';
import { sleep } from '../util/http.js';

export function createLLMEngine(config, rootDir, onEvent) {
  let provider;
  try {
    provider = config.llm.provider === 'mock' ? createMockProvider() : createProvider(config.llm);
  } catch (error) {
    provider = null;
  }
  const templates = loadPromptTemplates(rootDir);

  async function completeJSON(task, payload, schemaHint = 'json') {
    if (!provider) {
      throw new ModelUnavailableError(`LLM provider "${config.llm.provider}" is not available.`);
    }
    const template = templates[task];
    if (!template) throw new Error(`Unknown prompt task: ${task}`);
    const mockMarkers = {
      scope_refinement: 'MOCK_SCOPE',
      topic_discovery: 'MOCK_TOPICS',
      classification: 'MOCK_CLASSIFY',
      finding_generation: 'MOCK_FINDINGS',
      evidence_validation: 'MOCK_EVIDENCE',
      version_planning: 'MOCK_VERSION',
      prd_generation: 'MOCK_PRD',
      test_generation: 'MOCK_TESTS',
    };
    const systemContent =
      provider.name === 'mock' && mockMarkers[task]
        ? `${template}\n\nMock marker: ${mockMarkers[task]}\nReply with the schema above.`
        : template;
    const messages = buildMessages(systemContent, payload);
    let lastError;
    for (let attempt = 1; attempt <= config.llmMaxRetries; attempt += 1) {
      try {
        onEvent?.({
          type: 'model_call',
          task,
          attempt,
          provider: provider.name,
          model: provider.model,
          temperature: config.llm.temperature,
        });
        const parsed = await provider.complete(messages, {
          temperature: config.llm.temperature,
          timeoutMs: config.llmTimeoutMs,
        });
        if (parsed && typeof parsed === 'object') {
          onEvent?.({
            type: 'model_success',
            task,
            attempt,
          });
          return parsed;
        }
        lastError = new Error(`Model returned non-object JSON for ${task}.`);
      } catch (error) {
        lastError = error;
        onEvent?.({
          type: 'model_retry',
          task,
          attempt,
          error: error.message,
        });
        if (attempt < config.llmMaxRetries) {
          await sleep(2000 * attempt);
        }
      }
    }
    throw lastError;
  }

  return {
    available: () => Boolean(provider),
    provider: provider
      ? { name: provider.name, model: provider.model }
      : { name: config.llm.provider, model: 'unavailable' },
    completeJSON,
    schemaHint: () => 'structured JSON with schema enforced by the application',
  };
}
