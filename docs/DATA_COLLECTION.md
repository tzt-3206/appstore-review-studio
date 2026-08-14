# Data Collection Methodology

## Source

Reviews are collected from Apple's official iTunes RSS customer reviews feed for the
U.S. storefront:

```text
https://itunes.apple.com/us/rss/customerreviews/id={appId}/sortBy=mostRecent/json?page={page}
https://itunes.apple.com/us/rss/customerreviews/id={appId}/sortBy=mostHelpful/json?page={page}
```

This is a public feed provided by Apple for review distribution. The application does
not scrape the visible App Store product page with a browser, DOM parser, or scroll
automation.

## Storefront Guarantee

- The URL parser accepts `apps.apple.com/us/...` and `apps.apple.com/cn/...`.
- Review collection always uses the `/us/` feed path and `country=us` metadata lookup.
- A CN page is only used as a fallback way to identify the app; review data still comes
  from the U.S. storefront.

## Pagination and Limits

- The feed returns up to 50 entries per page.
- The collector walks pages until a page is empty or repeats the same review IDs.
- The feed is rate-limited in code: a minimum delay of 1.1 seconds between page
  requests (configurable via `REQUEST_DELAY_MS`).
- Each page request has 3 retries with backoff.
- If page 1 returns no entries, the collector retries the other sort and reports a
  clear collection failure so the UI can offer retry, import, or demo mode.

## Observed Data Limits

For `Workout for Women: Home & Gym` (id `839285684`), the U.S. feed returned 50 unique
most-recent reviews on the sample collection date. Apple's RSS feed exposes only a
recent subset of reviews; the app has about 530k ratings in App Store metadata, but
the feed does not expose all of them. This limitation is transparent: the sample file,
the UI, and the cached result all show the actual count.

If Apple responds with an empty feed after repeated requests (soft rate limiting), the
collector surfaces the warning and stops cleanly. The application never fabricates
review data.

## Cached Sample

`data/sample/raw_reviews.json` was collected from the official U.S. feed and is marked
`CACHED SAMPLE`. `data/sample/cached_result.json` is the precomputed pipeline result
for offline demo and interview review. Both files are inputs to demo mode and are not
substitutes for live collection when network and model access are available.

