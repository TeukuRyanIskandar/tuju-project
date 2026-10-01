/**
 * Tagging tests (spec 04 "Testing decisions"; ticket 01): the conservative
 * whole-word alias match — the spec's own cases (a Maybank-alias headline
 * tags Malayan Banking; short/fuzzy non-matches rejected; multi-company
 * headlines tag all; no-match → market-level) plus matched-alias auditability.
 */

import { matchCompanyTags, type TaggableCompany } from './news-tagging';

// The demo reference universe shape (Company.aliases + Instrument.shortName).
const MAYBANK: TaggableCompany = {
  companyId: 'maybank',
  shortName: 'MAYBANK',
  fullName: 'Malayan Banking Berhad',
  aliases: ['Maybank', 'MBB'],
};
const CIMB: TaggableCompany = {
  companyId: 'cimb',
  shortName: 'CIMB',
  fullName: 'CIMB Group Holdings Berhad',
  aliases: ['CIMB Group'],
};
const TENAGA: TaggableCompany = {
  companyId: 'tenaga',
  shortName: 'TENAGA',
  fullName: 'Tenaga Nasional Berhad',
  aliases: ['TNB', 'Tenaga Nasional'],
};

const UNIVERSE = [MAYBANK, CIMB, TENAGA];

it('tags a shortName headline ("Maybank posts record profit") with the shortName as matchedAlias', () => {
  expect(matchCompanyTags('Maybank posts record profit', UNIVERSE)).toEqual([
    { companyId: 'maybank', matchedAlias: 'MAYBANK' },
  ]);
});

it('tags via a curated alias (TNB → Tenaga Nasional Berhad)', () => {
  expect(matchCompanyTags('TNB wins transmission contract', UNIVERSE)).toEqual([
    { companyId: 'tenaga', matchedAlias: 'TNB' },
  ]);
});

it('matches case-insensitively and through the fullName', () => {
  expect(
    matchCompanyTags('malayan banking berhad declares dividend', UNIVERSE),
  ).toEqual([{ companyId: 'maybank', matchedAlias: 'Malayan Banking Berhad' }]);
});

it('rejects substring matches (Maybanking / TenagaX are not whole-word hits)', () => {
  expect(matchCompanyTags('Maybanking platform sees growth', UNIVERSE)).toEqual(
    [],
  );
  expect(matchCompanyTags('New fintech platform TenagaX launches', UNIVERSE)).toEqual(
    [],
  );
});

it('tags multi-word aliases only as a whole phrase', () => {
  // A company whose multi-word alias words hit no other alias of its own.
  const phrase: TaggableCompany = {
    companyId: 'phrase',
    shortName: 'XYZCO',
    fullName: 'Xyzco Holdings Berhad',
    aliases: ['Alpha Beta'],
  };
  // The words scattered apart must not hit — "Alpha" alone is not the alias.
  expect(matchCompanyTags('Alpha unit merges with Beta partner', [phrase])).toEqual(
    [],
  );
  expect(matchCompanyTags('Alpha Beta announces strategic deal', [phrase])).toEqual(
    [{ companyId: 'phrase', matchedAlias: 'Alpha Beta' }],
  );
});

it('a multi-company headline tags every confident hit (union, none dropped)', () => {
  const tags = matchCompanyTags('Maybank and CIMB lead banks higher', UNIVERSE);
  expect(tags).toEqual([
    { companyId: 'maybank', matchedAlias: 'MAYBANK' },
    { companyId: 'cimb', matchedAlias: 'CIMB' },
  ]);
});

it('no match → market-level (empty tags), never a guess', () => {
  expect(matchCompanyTags('Bursa Malaysia closes higher on regional rally', UNIVERSE)).toEqual(
    [],
  );
  // "Bank" alone must not fuzzy-match any alias.
  expect(matchCompanyTags('Banking sector gains across the board', UNIVERSE)).toEqual(
    [],
  );
});

it('a possessive form still counts as a whole word ("Maybank\'s …")', () => {
  expect(matchCompanyTags("Maybank's Q3 beats estimates", UNIVERSE)).toEqual([
    { companyId: 'maybank', matchedAlias: 'MAYBANK' },
  ]);
});
