function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

function mapRow(headers, cells) {
  const map = {};
  headers.forEach((header, index) => {
    map[header.toLowerCase()] = (cells[index] ?? '').trim();
  });
  return map;
}

function csvHeaderAliases() {
  return {
    id: 'review_id',
    review_id: 'review_id',
    rating: 'rating',
    title: 'title',
    subject: 'title',
    content: 'content',
    review: 'content',
    body: 'content',
    comment: 'content',
    version: 'version',
    date: 'date',
    updated: 'date',
    created_at: 'date',
    timestamp: 'date',
    language: 'language',
    lang: 'language',
    author: 'author',
    author_name: 'author',
    votes: 'vote_count',
    vote_count: 'vote_count',
    vote_sum: 'vote_sum',
  };
}

export function parseJsonImport(text) {
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : parsed.reviews ?? parsed.data ?? [];
  if (!Array.isArray(list)) {
    throw new Error('JSON import must be an array or an object with a reviews/data array.');
  }
  return list.map((item) => {
    if (typeof item === 'string') {
      return { title: '', content: item, rating: null };
    }
    return item;
  });
}

export function parseCsvImport(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV import needs a header row and at least one review.');
  const aliases = csvHeaderAliases();
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const output = [];
  for (const cells of rows.slice(1)) {
    const row = mapRow(headers, cells);
    const item = {};
    for (const [header, value] of Object.entries(row)) {
      const key = aliases[header] ?? header;
      item[key] = value;
    }
    output.push(item);
  }
  return output;
}

export function parseImportByType(type, text) {
  if (type === 'csv') return parseCsvImport(text);
  if (type === 'json') return parseJsonImport(text);
  throw new Error(`Unsupported import type: ${type}`);
}

