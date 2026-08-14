import { fetchJson } from '../util/http.js';
import { ModelUnavailableError } from './errors.js';

function extractJson(content) {
  if (typeof content !== 'string') return null;
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return null;
      }
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function ollamaChat({ baseUrl, model, numCtx }, messages, temperature, timeoutMs) {
  const data = await fetchJson(`${baseUrl}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      format: 'json',
      options: {
        temperature,
        num_ctx: numCtx,
      },
    }),
    headers: { 'Content-Type': 'application/json' },
    timeoutMs,
    retries: 1,
  });
  const content = data && data.message && data.message.content;
  if (typeof content !== 'string') {
    throw new ModelUnavailableError('Ollama returned no message content.', { response: data });
  }
  return extractJson(content);
}

async function openaiChat({ baseUrl, apiKey, model }, messages, temperature, timeoutMs) {
  if (!apiKey) {
    throw new ModelUnavailableError('OPENAI_API_KEY is not configured.');
  }
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  const body = {
    model,
    messages,
    temperature,
  };
  let data;
  try {
    data = await fetchJson(url, {
      method: 'POST',
      body: JSON.stringify({ ...body, response_format: { type: 'json_object' } }),
      headers,
      timeoutMs,
      retries: 1,
    });
  } catch (error) {
    if (error.status && error.status >= 400 && error.status < 500) {
      data = await fetchJson(url, {
        method: 'POST',
        body: JSON.stringify(body),
        headers,
        timeoutMs,
        retries: 1,
      });
    } else {
      throw error;
    }
  }
  const content = data && data.choices && data.choices[0] && data.choices[0].message?.content;
  if (typeof content !== 'string') {
    throw new ModelUnavailableError('OpenAI-compatible endpoint returned no content.', { response: data });
  }
  return extractJson(content);
}

export function createProvider(config) {
  const providerName = config.provider || 'off';
  if (providerName === 'ollama') {
    return {
      name: 'ollama',
      model: config.ollamaModel,
      async complete(messages, { temperature = 0.2, timeoutMs = 120000 } = {}) {
        return ollamaChat(
          {
            baseUrl: config.ollamaBaseUrl,
            model: config.ollamaModel,
            numCtx: config.ollamaNumCtx,
          },
          messages,
          temperature,
          timeoutMs,
        );
      },
    };
  }
  if (providerName === 'openai') {
    return {
      name: 'openai-compatible',
      model: config.openaiModel,
      async complete(messages, { temperature = 0.2, timeoutMs = 120000 } = {}) {
        return openaiChat(
          {
            baseUrl: config.openaiBaseUrl,
            apiKey: config.openaiApiKey,
            model: config.openaiModel,
          },
          messages,
          temperature,
          timeoutMs,
        );
      },
    };
  }
  throw new ModelUnavailableError(`LLM provider "${providerName}" is not available.`);
}

