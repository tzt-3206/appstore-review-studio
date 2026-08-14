export function computeReviewStats(reviews) {
  const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const languageCounts = {};
  const versionCounts = {};
  const dateValues = [];

  for (const review of reviews) {
    ratingDistribution[review.rating] = (ratingDistribution[review.rating] ?? 0) + 1;
    const lang = review.language || 'und';
    languageCounts[lang] = (languageCounts[lang] ?? 0) + 1;
    const version = review.version || 'unknown';
    versionCounts[version] = (versionCounts[version] ?? 0) + 1;
    if (review.date) dateValues.push(new Date(review.date).getTime());
  }

  const n = reviews.length || 0;
  const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
  const avg = n ? sum / n : 0;
  const negative = reviews.filter((r) => r.rating <= 2).length;
  const positive = reviews.filter((r) => r.rating >= 4).length;

  return {
    total: n,
    average_rating: Number(avg.toFixed(2)),
    rating_distribution: ratingDistribution,
    negative_count: negative,
    positive_count: positive,
    neutral_count: n - negative - positive,
    negative_share: n ? Number((negative / n).toFixed(3)) : 0,
    positive_share: n ? Number((positive / n).toFixed(3)) : 0,
    languages: Object.fromEntries(
      Object.entries(languageCounts).sort((a, b) => b[1] - a[1]),
    ),
    versions: Object.fromEntries(
      Object.entries(versionCounts).sort((a, b) => b[1] - a[1]),
    ),
    date_range: dateValues.length
      ? {
          start: new Date(Math.min(...dateValues)).toISOString(),
          end: new Date(Math.max(...dateValues)).toISOString(),
        }
      : null,
  };
}

