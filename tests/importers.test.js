import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonImport, parseCsvImport, parseImportByType } from '../src/data/importers.js';

test('parses JSON arrays and wrapped objects', () => {
  const array = [{ id: '1', rating: 5, title: 'A', content: 'hello' }];
  assert.equal(parseJsonImport(JSON.stringify(array)).length, 1);
  const wrapped = { reviews: [{ review_id: '2', rating: 1, content: 'bad' }] };
  assert.equal(parseJsonImport(JSON.stringify(wrapped))[0].review_id, '2');
});

test('parses CSV with quoted commas', () => {
  const csv = 'review_id,rating,title,content,version,date,language\nr1,5,"Great, app","Works, well",8.2.0,2026-08-01,en\nr2,1,Meh,"Too expensive",8.3.0,2026-08-02,en\n';
  const rows = parseCsvImport(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].review_id, 'r1');
  assert.equal(rows[0].title, 'Great, app');
  assert.equal(rows[0].content, 'Works, well');
});

test('rejects unsupported import type', () => {
  assert.throws(() => parseImportByType('xml', '<x/>'), /Unsupported/);
});

