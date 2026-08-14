const STOPWORDS = {
  en: new Set(['the', 'and', 'for', 'this', 'that', 'with', 'you', 'have', 'are', 'was', 'but', 'not', 'all', 'app', 'workout', 'love', 'good', 'great']),
  es: new Set(['el', 'la', 'los', 'las', 'que', 'para', 'una', 'por', 'con', 'este', 'esta', 'muy', 'bien', 'aplicacion', 'es']),
  fr: new Set(['le', 'la', 'les', 'pour', 'avec', 'cette', 'ce', 'est', 'sont', 'tres', 'bien', 'application', 'une', 'des']),
  de: new Set(['der', 'die', 'das', 'und', 'mit', 'fur', 'ist', 'sind', 'sehr', 'gut', 'app', 'ein', 'eine', 'nicht']),
  it: new Set(['il', 'lo', 'la', 'gli', 'per', 'con', 'questo', 'questa', 'e', 'sono', 'molto', 'bene', 'app', 'una']),
  pt: new Set(['o', 'a', 'os', 'as', 'para', 'com', 'este', 'esta', 'e', 'sao', 'muito', 'bom', 'app', 'uma', 'nao']),
  id: new Set(['yang', 'dan', 'untuk', 'dengan', 'ini', 'itu', 'sangat', 'baik', 'aplikasi', 'tidak', 'saya']),
  nl: new Set(['de', 'het', 'een', 'voor', 'met', 'en', 'is', 'zijn', 'heel', 'goed', 'app', 'niet']),
  pl: new Set(['i', 'w', 'z', 'dla', 'to', 'jest', 'sa', 'bardzo', 'dobra', 'aplikacja', 'nie', 'na']),
};

function charCount(regex, text) {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

export function detectLanguage(text) {
  const t = String(text ?? '').trim();
  if (!t) return 'und';
  const lower = t.toLowerCase();
  const hiragana = charCount(/[\u3040-\u309f]/g, lower);
  const katakana = charCount(/[\u30a0-\u30ff]/g, lower);
  const han = charCount(/[\u3400-\u4dbf\u4e00-\u9fff]/g, lower);
  const hangul = charCount(/[\uac00-\ud7af\u1100-\u11ff]/g, lower);
  const cyrillic = charCount(/[\u0400-\u04ff]/g, lower);
  const arabic = charCount(/[\u0600-\u06ff]/g, lower);
  const hebrew = charCount(/[\u0590-\u05ff]/g, lower);
  const thai = charCount(/[\u0e00-\u0e7f]/g, lower);
  const devanagari = charCount(/[\u0900-\u097f]/g, lower);
  const greek = charCount(/[\u0370-\u03ff]/g, lower);

  if (hiragana + katakana > 0) return 'ja';
  if (hangul > 0) return 'ko';
  if (han > 0) return 'zh';
  if (cyrillic > 0) return 'ru';
  if (arabic > 0) return 'ar';
  if (hebrew > 0) return 'he';
  if (thai > 0) return 'th';
  if (devanagari > 0) return 'hi';
  if (greek > 0) return 'el';

  const words = lower.split(/[^a-z0-9']+/).filter(Boolean);
  if (words.length === 0) return 'und';
  let bestLang = 'en';
  let bestScore = 0;
  for (const [lang, wordsSet] of Object.entries(STOPWORDS)) {
    const score = words.filter((word) => wordsSet.has(word)).length;
    if (score > bestScore) {
      bestLang = lang;
      bestScore = score;
    }
  }
  return bestLang;
}

