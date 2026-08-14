import fs from 'node:fs';
import path from 'node:path';

const PROMPT_FILES = {
  scope_refinement: 'scope_refinement.md',
  topic_discovery: 'topic_discovery.md',
  classification: 'classification.md',
  finding_generation: 'finding_generation.md',
  evidence_validation: 'evidence_validation.md',
  version_planning: 'version_planning.md',
  prd_generation: 'prd_generation.md',
  test_generation: 'test_generation.md',
};

export function loadPromptTemplates(rootDir) {
  const promptsDir = path.join(rootDir, 'prompts');
  const templates = {};
  for (const [key, file] of Object.entries(PROMPT_FILES)) {
    templates[key] = fs.readFileSync(path.join(promptsDir, file), 'utf8');
  }
  return templates;
}

export function buildMessages(template, payload) {
  return [
    {
      role: 'system',
      content: template,
    },
    {
      role: 'user',
      content: JSON.stringify(payload),
    },
  ];
}

