import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage } from '../src/data/language.js';

test('detects CJK and Latin languages deterministically', () => {
  assert.equal(detectLanguage('这个应用很好用，我很喜欢'), 'zh');
  assert.equal(detectLanguage('このアプリはとても良いです'), 'ja');
  assert.equal(detectLanguage('이 앱 정말 좋아요'), 'ko');
  assert.equal(detectLanguage('This app is great and I use it every day'), 'en');
  assert.equal(detectLanguage('Esta aplicacion es muy buena'), 'es');
  assert.equal(detectLanguage('Cette application est tres bien'), 'fr');
  assert.equal(detectLanguage('Это приложение очень хорошее'), 'ru');
  assert.equal(detectLanguage(''), 'und');
});

