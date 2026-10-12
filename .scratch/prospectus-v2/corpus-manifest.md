# prospectus-v2 demo corpus manifest

Location: `.scratch/free-tier/demo-corpus/prospectuses/` (tracked in git). Part 1 files were added in `c00c89b` (2026-09-30). Parts 2+ were added on 2026-10-12.
Source: i3investor's IPO file pages (`https://klse.i3investor.com/web/stock/ipo-prospectus/<code>`). Each `?file=<id>` page links the CDN file. All URLs below were retrieved on 2026-10-12. The Part 1 sha256 values match the files downloaded on 2026-09-30, so all parts come from the same documents.

CDN base: `https://cdn1.i3investor.com/my/files/st88k/`

| Company | i3 page | File | Part | Pages | sha256 (12) | CDN path (under base) |
|---|---|---|---|---|---|---|
| Fibromat (M) Berhad | 0355 | `fbbhd_fibromat-m-berhad_2025-04-11_part1.pdf` | 1 of 3 | 141 | `04799259e0e6` | `03026_FBBHD/ipo/2025/03026_FBBHD_IPO_IPOP_FibromatProspectusdated11April2025Part1_844586721.pdf` |
| | | `fbbhd_fibromat-m-berhad_2025-04-11_part2.pdf` | 2 of 3 | 95 | `132fa49a7b4f` | `03026_FBBHD/ipo/2025/03026_FBBHD_IPO_IPOP_FibromatProspectusdated11April2025Part2_844586722.pdf` |
| | | `fbbhd_fibromat-m-berhad_2025-04-11_part3.pdf` | 3 of 3 | 168 | `d65f90d19fdd` | `03026_FBBHD/ipo/2025/03026_FBBHD_IPO_IPOP_FibromatProspectusdated11April2025Part3_844586723.pdf` |
| Insights Analytics Berhad | 0376 | `iab_insights-analytics-berhad_2025-10-07_part1.pdf` | 1 of 4 | 169 | `a7b533ad55a8` | `0376_IAB/ipo/2025/0376_IAB_IPO_IPOP_InsightsAnalyticsBerhadProspectusPart1_-1883999213.pdf` |
| | | `iab_insights-analytics-berhad_2025-10-07_part2.pdf` | 2 of 4 | 45 | `581e317350d0` | `0376_IAB/ipo/2025/0376_IAB_IPO_IPOP_InsightsAnalyticsBerhadProspectusPart2_-1883999212.pdf` |
| | | `iab_insights-analytics-berhad_2025-10-07_part3.pdf` | 3 of 4 | 25 | `e5080710e46c` | `0376_IAB/ipo/2025/0376_IAB_IPO_IPOP_InsightsAnalyticsBerhadProspectusPart3_-1883999211.pdf` |
| | | `iab_insights-analytics-berhad_2025-10-07_part4.pdf` | 4 of 4 | 175 | `020213f43e26` | `0376_IAB/ipo/2025/0376_IAB_IPO_IPOP_InsightsAnalyticsBerhadProspectusPart4_-1883999210.pdf` |
| Lim Seong Hai Capital Berhad | 03047 | `lsh_lim-seong-ha-capital-berhad_2025_part1of3.pdf` | 1 of 3 | 140 | `f6db2668e462` | `03047_LSH/ipo/2025/03047_LSH_IPO_IPOP_LSHCapitalProspectusPart1of3_1114219212.pdf` |
| | | `lsh_lim-seong-ha-capital-berhad_2025_part2of3.pdf` | 2 of 3 | 168 | `e9027b011d91` | `03047_LSH/ipo/2025/03047_LSH_IPO_IPOP_LSHCapitalProspectusPart2of3_1114249003.pdf` |
| | | `lsh_lim-seong-ha-capital-berhad_2025_part3of3.pdf` | 3 of 3 | 286 | `4166fa3cad75` | `03047_LSH/ipo/2025/03047_LSH_IPO_IPOP_LSHCapitalProspectusPart3of3_1114278794.pdf` |

The company is "Lim Seong **Hai**". The `lim-seong-ha` file prefix is a historical typo, kept because the test pins and the parse keys use it.

## Routing on the merged documents

Parts are grouped by prefix (`group_pdf_parts`) and merged with `merge_pdf_parts` before parsing. The merge is deterministic, so the `pdfSha256` key is stable. With every part present, all six sections locate in all three prospectuses, so `EXPECTED_FALLBACKS` in `services/ai/tests/test_prospectus_corpus.py` is empty.
