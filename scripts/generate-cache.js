import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT_DIR } from '../src/config.js';
import { runPipeline } from '../src/pipeline.js';

const sampleFile = path.join(ROOT_DIR, 'data', 'sample', 'raw_reviews.json');
if (!fs.existsSync(sampleFile)) {
  console.error('Sample data missing. Run `npm run collect:sample` first.');
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(sampleFile, 'utf8'));
const reviews = payload.reviews ?? [];
console.log(`Using ${reviews.length} cached U.S. App Store reviews.`);
console.log(`LLM: ${config.llm.provider} / ${config.llm.openaiModel}`);

const input = {
  job_id: 'cached-demo-generator',
  source: {
    type: 'json',
    text: JSON.stringify(reviews),
    fileName: 'raw_reviews.json',
  },
  goal: 'Analyze subscription conversion problems and low-rated review themes. Focus on workout usability issues users mention.',
  constraints: {},
  options: { max_reviews: config.maxReviews },
};

const result = await runPipeline(input, {
  config,
  rootDir: ROOT_DIR,
  onEvent: (event) => {
    if (event.type === 'stage_end') {
      console.log(`[stage] ${event.stage_id}: ${event.status} (${event.duration_ms ?? 0}ms)`);
    }
    if (event.type === 'model_call') {
      console.log(`[llm] ${event.task} attempt ${event.attempt} (${event.provider}/${event.model})`);
    }
  },
});

const output = {
  ...result,
  cached: true,
  cached_label: 'CACHED SAMPLE',
  cached_at: new Date().toISOString(),
  cached_note:
    'Precomputed from the official U.S. App Store RSS feed using the configured model. This is offline demo data, not a live run.',
  input: {
    ...input,
    source: {
      ...input.source,
      text: '[sample file]',
    },
  },
};

const target = path.join(ROOT_DIR, 'data', 'sample', 'cached_result.json');
fs.writeFileSync(target, JSON.stringify(output, null, 2));
console.log(`Cached demo written to ${target}`);
console.log(
  `Stages: ${output.stages.map((s) => `${s.id}:${s.status}`).join(' | ')}`,
);
console.log(
  `Findings=${output.artifacts.findings?.findings?.length ?? 0} Requirements=${output.artifacts.requirements?.length ?? 0} Tests=${output.artifacts.test_cases?.length ?? 0}`,
);

