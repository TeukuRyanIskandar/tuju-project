import { ListingBoard } from '../data/entities/enums';

/**
 * The curated prospectus demo corpus (spec 06, tickets 04/09).
 *
 * Three real 2025 Bursa company IPOs — manually downloaded prospectus PDFs,
 * NO scraper (decision ticket 09 §6: public regulatory disclosure ≠ licensed
 * to redistribute; automated fetching is pushed to the licensed-feed boundary).
 * The PDFs live in the repo at `.scratch/free-tier/demo-corpus/prospectuses/`
 * and are seeded to the artifacts bucket by the one-shot `seed-prospectus`
 * worker command (`prospectus-corpus.service.ts`).
 *
 * Every field below is per the public filing (verified against the Bursa/
 * SC-filed prospectus announcements), making this the one showcase corpus on
 * `real` provenance — no synthetic prices, no aggregator snapshot.
 *
 * Caveat (ticket 09): i3investor splits prospectuses into parts; the corpus
 * is Part-1-only for now, which suffices to validate parse + section routing.
 */

/** S3 key prefix for seeded prospectus PDFs. */
export const PROSPECTUS_S3_PREFIX = 'prospectus';

/**
 * Default corpus directory (repo-root-relative): where the manually-downloaded
 * PDFs live. Overridable per call (`seed-prospectus [dir]`) or via
 * `PROSPECTUS_CORPUS_DIR` — the Docker image does not carry `.scratch/`, so a
 * compose run mounts the corpus and passes the mount path explicitly.
 */
export const DEFAULT_PROSPECTUS_CORPUS_DIR =
  '.scratch/free-tier/demo-corpus/prospectuses';

export interface ProspectusCorpusEntry {
  /** Issuer name exactly as filed. */
  readonly companyName: string;
  /** Board the shares listed on (all three are ACE). */
  readonly board: ListingBoard;
  /** Actual listing date per the filed timetable. */
  readonly listingDate: string;
  /** Issue/offer price per share (RM) per the filing. */
  readonly offerPrice: number;
  /** File name inside the corpus directory. */
  readonly fileName: string;
  /** Full S3 key the PDF is seeded under. */
  readonly prospectusS3Key: string;
}

function entry(
  companyName: string,
  board: ListingBoard,
  listingDate: string,
  offerPrice: number,
  fileName: string,
): ProspectusCorpusEntry {
  return {
    companyName,
    board,
    listingDate,
    offerPrice,
    fileName,
    prospectusS3Key: `${PROSPECTUS_S3_PREFIX}/${fileName}`,
  };
}

/**
 * - Insights Analytics Berhad (IAB, 0376): ACE, prospectus dated 07 Oct 2025,
 *   listed 27 Oct 2025 at RM0.36.
 * - Lim Seong Hai Capital Berhad (LSHBHD, 03047): ACE (LEAP→ACE transfer),
 *   prospectus dated 28 Feb 2025, listed 21 Mar 2025 at RM0.88.
 * - Fibromat (M) Berhad (FIBRO, 0355): ACE (LEAP→ACE transfer), prospectus
 *   dated 11 Apr 2025, listed 08 May 2025 at RM0.55.
 */
export const PROSPECTUS_CORPUS: readonly ProspectusCorpusEntry[] = [
  entry(
    'Insights Analytics Berhad',
    ListingBoard.Ace,
    '2025-10-27',
    0.36,
    'iab_insights-analytics-berhad_2025-10-07_part1.pdf',
  ),
  entry(
    'Lim Seong Hai Capital Berhad',
    ListingBoard.Ace,
    '2025-03-21',
    0.88,
    'lsh_lim-seong-ha-capital-berhad_2025_part1of3.pdf',
  ),
  entry(
    'Fibromat (M) Berhad',
    ListingBoard.Ace,
    '2025-05-08',
    0.55,
    'fbbhd_fibromat-m-berhad_2025-04-11_part1.pdf',
  ),
];
