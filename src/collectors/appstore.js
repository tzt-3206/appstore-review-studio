import { fetchJson, sleep } from '../util/http.js';

const APP_STORE_URL_RE =
  /^https?:\/\/apps\.apple\.com\/([a-z]{2})\/(?:app\/([^/]+)\/)?id(\d+)(?:\?.*)?$/i;

export function parseAppStoreUrl(rawUrl) {
  const url = String(rawUrl ?? '').trim();
  const match = url.match(APP_STORE_URL_RE);
  if (!match) {
    return {
      ok: false,
      error:
        'Invalid App Store URL. Expected https://apps.apple.com/{country}/app/{name}/id{appId}',
    };
  }
  const country = match[1].toLowerCase();
  return {
    ok: true,
    country,
    slug: match[2] ?? '',
    appId: match[3],
    normalizedUrl: `https://apps.apple.com/${country}/app/id${match[3]}`,
  };
}

function mapFeedEntry(entry, sort) {
  const get = (obj) => (obj && typeof obj.label === 'string' ? obj.label : '');
  return {
    review_id: get(entry.id),
    author: get(entry.author && entry.author.name),
    rating: Number.parseInt(get(entry['im:rating']), 10),
    version: get(entry['im:version']),
    title: get(entry.title),
    content: get(entry.content),
    date: get(entry.updated),
    vote_count: Number.parseInt(get(entry['im:voteCount']), 10) || 0,
    vote_sum: Number.parseInt(get(entry['im:voteSum']), 10) || 0,
    source: `itunes_rss_us_${sort}`,
  };
}

export async function lookupAppMetadata(appId) {
  const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(appId)}&country=us`;
  const data = await fetchJson(url, {
    timeoutMs: 20000,
    retries: 3,
    delayMs: 1000,
  });
  const result = data && data.results && data.results[0];
  if (!result) throw new Error(`App Store lookup returned no app for id ${appId}.`);
  return {
    track_id: result.trackId,
    name: result.trackName,
    seller: result.sellerName,
    version: result.version,
    user_rating_count: result.userRatingCount,
    average_user_rating: result.averageUserRating,
    minimum_os_version: result.minimumOsVersion,
    release_date: result.currentVersionReleaseDate,
    release_notes: result.releaseNotes,
    genres: result.genres,
    track_view_url: result.trackViewUrl,
  };
}

async function fetchReviewPage(appId, sort, page, { onProgress, requestDelayMs }) {
  const url = `https://itunes.apple.com/us/rss/customerreviews/id=${encodeURIComponent(appId)}/sortBy=${sort}/json?page=${page}`;
  const data = await fetchJson(url, {
    timeoutMs: 30000,
    retries: 3,
    delayMs: 1000,
    onRetry: ({ attempt, error }) => {
      onProgress?.({
        type: 'retry',
        sort,
        page,
        attempt,
        message: `${sort} page ${page} retry ${attempt}: ${error.message}`,
      });
    },
  });
  if (!data || !data.feed) {
    throw new Error(`Unexpected feed response for ${sort} page ${page}.`);
  }
  const entries = Array.isArray(data.feed.entry) ? data.feed.entry : [];
  if (page > 1 && entries.length === 0) return [];
  return entries.map((entry) => mapFeedEntry(entry, sort));
}

export async function collectAppStoreReviews(appId, options = {}) {
  const {
    maxReviews = 300,
    maxPages = 10,
    requestDelayMs = 1100,
    sorts = ['mostRecent', 'mostHelpful'],
    onProgress,
  } = options;

  const rawReviews = [];
  const seenIds = new Set();
  const log = [];
  const warnings = [];

  for (const sort of sorts) {
    let fetchedAny = false;
    for (let page = 1; page <= maxPages; page += 1) {
      if (rawReviews.length >= maxReviews) break;
      try {
        const entries = await fetchReviewPage(appId, sort, page, {
          onProgress,
          requestDelayMs,
        });
        if (entries.length === 0) {
          if (page === 1) {
            warnings.push(`${sort} feed returned no reviews for app ${appId}.`);
            onProgress?.({
              type: 'warning',
              sort,
              page,
              message: `No reviews returned for ${sort}.`,
            });
          }
          break;
        }
        fetchedAny = true;
        let added = 0;
        let duplicatePage = true;
        for (const entry of entries) {
          if (!seenIds.has(entry.review_id)) {
            seenIds.add(entry.review_id);
            rawReviews.push(entry);
            added += 1;
            duplicatePage = false;
          }
        }
        if (duplicatePage && page > 1) {
          warnings.push(`${sort} page ${page} repeated the same reviews; stopping pagination.`);
          onProgress?.({
            type: 'warning',
            sort,
            page,
            message: 'Feed repeated the same reviews; stopping pagination.',
          });
          break;
        }
        onProgress?.({
          type: 'page',
          sort,
          page,
          count: entries.length,
          added,
          total: rawReviews.length,
        });
        log.push({ sort, page, count: entries.length, added });
        if (entries.length < 50) break;
        await sleep(requestDelayMs);
      } catch (error) {
        warnings.push(`${sort} page ${page} failed: ${error.message}`);
        onProgress?.({
          type: 'error',
          sort,
          page,
          message: error.message,
        });
        break;
      }
    }
    if (rawReviews.length === 0 && sort === 'mostRecent') {
      throw new Error(`App Store review feed returned no reviews for app ${appId}.`);
    }
    await sleep(requestDelayMs);
  }

  return {
    rawReviews,
    log,
    warnings,
    meta: {
      source: 'Apple iTunes RSS customer reviews (U.S. storefront)',
      storefront: 'us',
      appId,
      fetched_at: new Date().toISOString(),
      feed_sorts: sorts,
    },
  };
}
