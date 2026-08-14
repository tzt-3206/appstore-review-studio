export function padId(prefix, number, width = 3) {
  return `${prefix}-${String(number).padStart(width, '0')}`;
}

export function cleanToken(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 500);
}

export function stableSortReviews(reviews) {
  return reviews
    .map((review, index) => ({ review, index }))
    .sort((a, b) => {
      const da = a.review.date ? new Date(a.review.date).getTime() : 0;
      const db = b.review.date ? new Date(b.review.date).getTime() : 0;
      if (da !== db) return db - da;
      return a.index - b.index;
    })
    .map((item) => item.review);
}

