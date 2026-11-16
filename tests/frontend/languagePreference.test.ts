import { describe, expect, it } from 'vitest';
import { browserLocale, initialLocale, languageTag, translate } from '../../src/i18n/locale';
import { number } from '../../src/lib/format';
import { sourceCoverage, sourceMessage, sourceName } from '../../src/lib/sourceDescription';
import { liveSnapshot, now } from '../unit/fixtures';

describe('browser language and explicit language preference', () => {
  it.each([
    [['fr-CH', 'en-US'], 'fr'],
    [['en-GB', 'fr-FR'], 'en'],
    [['de-DE', 'fr-CA'], 'fr'],
    [['es', 'en'], 'en'],
    [[' FR_ch '], 'fr'],
    [['de-DE'], 'en'],
    [[], 'en'],
  ])('respects supported browser preferences in order %j', (languages, expected) => {
    expect(browserLocale(languages as string[])).toBe(expected);
  });

  it('gives only a valid explicit choice precedence over the browser', () => {
    expect(initialLocale('en', ['fr-CH'])).toBe('en');
    expect(initialLocale('fr', ['en-US'])).toBe('fr');
    for (const invalid of [null, undefined, '', 'de', 'en-US', '<script>'])
      expect(initialLocale(invalid, ['fr-FR'])).toBe('fr');
  });

  it('formats numbers by the selected language without changing identifiers or amounts', () => {
    expect(number(1234.5, 2, 'en')).toBe('1,234.5');
    expect(number(1234.5, 2, 'fr')).toBe(
      new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 2 }).format(1234.5),
    );
    expect(number(null, 2, 'en')).toBe('—');
    expect(languageTag('en')).toBe('en-US');
    expect(languageTag('fr')).toBe('fr-CH');
    expect(translate('en', 'En attente', 'Pending')).toBe('Pending');
  });

  it('keeps source evidence and limited coverage truthful in English without mutating the API data', () => {
    const snapshot = liveSnapshot('bitcoin', now);
    const original = structuredClone(snapshot);
    const english = sourceCoverage(snapshot, 'en');
    expect(english).toContain(snapshot.source);
    expect(english).toContain('Limited sample');
    expect(english).toContain('No fresh node candidate');
    expect(english).toContain('disappearance proves no confirmation');
    expect(sourceCoverage(snapshot, 'fr')).toBe(snapshot.coverage);
    expect(snapshot).toEqual(original);
    expect(sourceName(snapshot, 'en')).toBe(snapshot.source);
    expect(sourceName({ ...snapshot, mode: 'demo' }, 'en')).toContain('fictional data');
    expect(sourceMessage({ ...snapshot, status: 'stale' }, null, 'en')).toContain(
      'original timestamps',
    );
    expect(sourceMessage(null, 'Erreur', 'en')).toContain('retries automatically');
  });
});
