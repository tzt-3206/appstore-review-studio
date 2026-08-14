import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, ROOT_DIR, publicConfig } from './config.js';
import { JobStore } from './jobs.js';
import { runPipeline } from './pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const jobs = new JobStore();

function saveLiveResult(jobId, result) {
  try {
    const dir = path.join(ROOT_DIR, 'data', 'cache', 'live');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${jobId}.json`),
      JSON.stringify({ ...result, job_id: jobId, cached: true, cached_label: 'LIVE RUN CACHE' }, null, 2),
    );
  } catch (error) {
    console.error('Could not save live result:', error.message);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let cleanPath;
  try {
    cleanPath = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  const filePath = path.join(PUBLIC_DIR, cleanPath === '' ? 'index.html' : cleanPath);
  const publicRoot = path.resolve(PUBLIC_DIR);
  if (!path.resolve(filePath).startsWith(publicRoot + path.sep) && path.resolve(filePath) !== publicRoot) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  });
}

function handleSse(req, res, job) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: snapshot\ndata: ${JSON.stringify(jobs.snapshot(job.id))}\n\n`);

  if (job.status === 'done' || job.status === 'failed') {
    res.write(
      `event: done\ndata: ${JSON.stringify({
        status: job.status,
        result: job.result,
        error: job.error,
      })}\n\n`,
    );
    res.end();
    return;
  }

  const onEvent = (event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  const onDone = (event) => {
    res.write(`event: done\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  };
  job.emitter.on('event', onEvent);
  job.emitter.on('done', onDone);
  req.on('close', () => {
    job.emitter.removeListener('event', onEvent);
    job.emitter.removeListener('done', onDone);
  });
}

function handleAnalyze(req, res) {
  readBody(req)
    .then((body) => {
      const source = body.source;
      if (!source || !source.type) {
        sendJson(res, 400, { error: 'source.type is required (url, json, csv, demo).' });
        return;
      }
      if (source.type === 'url' && !/^https?:\/\/apps\.apple\.com\//i.test(String(source.url ?? ''))) {
        sendJson(res, 400, { error: 'A valid apps.apple.com URL is required for URL mode.' });
        return;
      }
      if ((source.type === 'json' || source.type === 'csv') && typeof source.text !== 'string') {
        sendJson(res, 400, { error: `source.text is required for ${source.type} import.` });
        return;
      }
      const input = {
        job_id: null,
        source,
        goal: String(body.goal ?? '').trim(),
        constraints: {
          min_rating: Number.isInteger(body.constraints?.min_rating) ? body.constraints.min_rating : null,
          max_rating: Number.isInteger(body.constraints?.max_rating) ? body.constraints.max_rating : null,
          versions: Array.isArray(body.constraints?.versions) ? body.constraints.versions : [],
          languages: Array.isArray(body.constraints?.languages) ? body.constraints.languages : [],
          max_reviews: Number.isInteger(body.constraints?.max_reviews) ? body.constraints.max_reviews : null,
        },
        options: {
          max_reviews: Number.isInteger(body.options?.max_reviews) ? body.options.max_reviews : config.maxReviews,
        },
      };
      const job = jobs.create(input);
      input.job_id = job.id;
      jobs.start(job.id);
      sendJson(res, 202, { job_id: job.id, status: 'running' });

      runPipeline(input, {
        config,
        rootDir: ROOT_DIR,
        onEvent: (event) => jobs.recordEvent(job.id, { ...event, job_id: job.id }),
      })
        .then((result) => {
          jobs.finish(job.id, result);
          saveLiveResult(job.id, result);
        })
        .catch((error) => jobs.finish(job.id, null, { message: error.message }));
    })
    .catch((error) => {
      sendJson(res, 400, { error: `Invalid request body: ${error.message}` });
    });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true, time: new Date().toISOString() });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/config') {
    sendJson(res, 200, { ...publicConfig(), sample_available: fs.existsSync(path.join(ROOT_DIR, 'data', 'sample', 'cached_result.json')) });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/prompts') {
    const promptsDir = path.join(ROOT_DIR, 'prompts');
    const files = fs.readdirSync(promptsDir).filter((f) => f.endsWith('.md')).sort();
    sendJson(
      res,
      200,
      files.map((file) => ({
        name: file,
        content: fs.readFileSync(path.join(promptsDir, file), 'utf8'),
      })),
    );
    return;
  }
  if (req.method === 'POST' && pathname === '/api/analyze') {
    handleAnalyze(req, res);
    return;
  }
  const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (req.method === 'GET' && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) {
      sendJson(res, 404, { error: 'Job not found' });
      return;
    }
    sendJson(res, 200, jobs.snapshot(job.id));
    return;
  }
  const eventMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);
  if (req.method === 'GET' && eventMatch) {
    const job = jobs.get(eventMatch[1]);
    if (!job) {
      sendJson(res, 404, { error: 'Job not found' });
      return;
    }
    handleSse(req, res, job);
    return;
  }
  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  serveStatic(req, res, pathname);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason?.message ?? reason);
});

server.listen(config.port, config.host, () => {
  console.log(`App Store Review Studio running at http://${config.host}:${config.port}`);
});
