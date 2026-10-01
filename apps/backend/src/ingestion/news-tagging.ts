/**
 * Deterministic RSS headline → company ticker-tagging (spec 04 §2; ticket 01).
 *
 * A PURE matcher — the tagging step inside the RSS ingest cadence (folded into
 * the nightly ingest for the demo), **not** an AI job. The rule is
 * conservative, case-insensitive whole-word matching of the headline against
 * each company's alias set (`shortName` via its Instrument, `fullName`, and the
 * curated `aliases` list):
 *
 * - **No fuzzy/substring matching** — "Maybanking" must not tag MAYBANK, and a
 *   short shortName ("CIMB") only matches as a whole word.
 * - A company is tagged ONCE, on its first hit — `shortName` is tried first,
 *   so `matchedAlias` prefers it ("match primarily on shortName/alias").
 * - Multi-company headlines tag every confident hit (union, none dropped);
 *   no match → the article stays untagged = market-level news.
 */

/** One company's alias set, as the tagger sees it (built by the worker). */
export interface TaggableCompany {
  companyId: string;
  /** Instrument shortName — the primary match target. */
  shortName: string;
  fullName: string;
  aliases: readonly string[];
}

/** One confident whole-word hit: the company + the alias that matched. */
export interface CompanyTagMatch {
  companyId: string;
  matchedAlias: string;
}

/** Escape regex metacharacters in an alias so it can only match literally. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Does `needle` occur in `haystack` as a whole word (case-insensitive)?
 * Word boundaries are non-letter/non-number neighbours (Unicode-aware, so
 * "Maybank's" tags and "Maybanking"/"TenagaX" do not) — NOT `\b`, which is
 * ASCII-only.
 */
function wholeWordMatch(haystack: string, needle: string): boolean {
  const trimmed = needle.trim();
  if (trimmed.length === 0) return false;
  const re = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(trimmed)}(?=[^\\p{L}\\p{N}]|$)`,
    'iu',
  );
  return re.test(haystack);
}

/**
 * Match one headline against every company's alias set. Returns one
 * {@link CompanyTagMatch} per confidently-matched company (shortName-first
 * within a company, so `matchedAlias` records the primary hit).
 */
export function matchCompanyTags(
  headline: string,
  companies: readonly TaggableCompany[],
): CompanyTagMatch[] {
  const matches: CompanyTagMatch[] = [];
  for (const company of companies) {
    const candidates = [company.shortName, company.fullName, ...company.aliases];
    for (const alias of candidates) {
      if (wholeWordMatch(headline, alias)) {
        matches.push({ companyId: company.companyId, matchedAlias: alias });
        break;
      }
    }
  }
  return matches;
}
