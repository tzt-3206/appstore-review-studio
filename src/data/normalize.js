import crypto from 'node:crypto';
import { detectLanguage } from './language.js';

function asInt(value, fallback = null) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function asDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fingerprintReview({ rating, version, date, title, content }) {
  return crypto
    .createHash('sha256')
    .update([rating, version, date, cleanText(title), cleanText(content)].join('|'))
    .digest('hex');
}

export function normalizeRawReview(raw, index, source = 'import') {
  const title = cleanText(raw.title ?? raw.name ?? '');
  const content = cleanText(raw.content ?? raw.review ?? raw.body ?? raw.comment ?? '');
  const rating = asInt(raw.rating);
  const date = asDate(raw.date ?? raw.updated ?? raw.created_at ?? raw.timestamp);
  const version = cleanText(raw.version ?? '');
  const language = String(raw.language ?? '').slice(0, 2).toLowerCase() || detectLanguage(`${title} ${content}`);

  return {
    external_id: cleanText(raw.review_id ?? raw.id ?? raw.external_id ?? `external-${index + 1}`),
    author: cleanText(raw.author ?? raw.author_name ?? ''),
    rating,
    version,
    title,
    content,
    date,
    language,
    vote_count: asInt(raw.vote_count ?? raw.votes ?? 0, 0),
    vote_sum: asInt(raw.vote_sum ?? raw.voteSum ?? 0, 0),
    source,
    raw,
  };
}

export function toInternalReview(normalized, number) {
  return {
    review_id: `R-${String(number).padStart(4, '0')}`,
    external_id: normalized.external_id,
    author: normalized.author,
    rating: normalized.rating,
    version: normalized.version,
    title: normalized.title,
    content: normalized.content,
    date: normalized.date,
    language: normalized.language,
    vote_count: normalized.vote_count,
    vote_sum: normalized.vote_sum,
    source: normalized.source,
    dedupe_key: fingerprintReview(normalized),
  };
}

