import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, ROOT_DIR } from '../src/config.js';
import { collectAppStoreReviews, lookupAppMetadata } from '../src/collectors/appstore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appId = process.argv[2] || '839285684';
const outDir = path.join(ROOT_DIR, 'data', 'sample');
fs.mkdirSync(outDir, { recursive: true });

const meta = await lookupAppMetadata(appId);
const collection = await collectAppStoreReviews(appId, {
  maxReviews: config.maxReviews,
  onProgress: (event) => console.log(event),
});

const payload = {
  cached: true,
  cached_label: 'CACHED SAMPLE',
  created_at: new Date().toISOString(),
  app: meta,
  collection,
  reviews: collection.rawReviews,
};

const target = path.join(outDir, 'raw_reviews.json');
fs.writeFileSync(target, JSON.stringify(payload, null, 2));
console.log(`Wrote ${payload.reviews.length} reviews to ${target}`);

