# Research: FBM KLCI 30 membership + Yahoo `.KL` map

Type: research
Status: resolved
Blocked by: 01
Blocks: 07 (handoff paste)

## Question

Produce a **paste-ready** curated table of the current FBM KLCI 30 ordinary
shares for `klci30-universe.ts`:

| stockCode | yahooSymbol | shortName | fullName | sectorName | aliases (suggested) |

Constraints from ticket 01 / parent:

- Ordinary shares on Main board only (KLCI constituents).
- Yahoo symbols use Bursa code + `.KL` (e.g. `1155.KL`).
- No live scrape in product — this research is a one-shot human/agent paste.
- Prefer primary sources (FTSE Russell / Bursa Malaysia constituent notices)
  over random blogs; note as-of date and source URLs.
- Spot-check a few Yahoo symbols resolve (optional smoke) if tooling allows.

## Notes

- Demo script exemplar: `1155` / MAYBANK must be in the list.
- Overlap with `REFERENCE_UNIVERSE` (1155, 1023, 5347, 6888, …) is fine.
- If a constituent uses a non-obvious Yahoo ticker, document the exception.

## Answer

**Paste-ready KLCI 30 as of research date 2026-10-09.** All `board = Main`.
Yahoo pattern is uniformly `{stockCode}.KL` (no exceptions found).

### Sources

- Constituent names + Bursa codes + wiki sectors:
  [Wikipedia — FTSE Bursa Malaysia KLCI § Constituents](https://en.wikipedia.org/wiki/FTSE_Bursa_Malaysia_KLCI)
  (scraped 2026-10-09; treat as curated snapshot — re-verify against FTSE/Bursa
  notices before public launch if membership matters legally).
- `shortName`: Yahoo Finance chart `meta.shortName` for each `{code}.KL`
  (smoke-checked; all 30 resolved MYR).
- `sectorName`: mapped from wiki sector strings onto Bursa-ish labels already
  used in free-tier (`Financial Services`, `Plantation`, …). **Not** a live
  Bursa sector feed — good enough for PoC seed / search facets.
- Notable rename already reflected: **SD Guthrie** (`5285`, Yahoo `SDG`) —
  formerly Sime Darby Plantation in older lists.

### Smoke checks

Resolved: `1155.KL` MAYBANK, `1023.KL` CIMB, `5326.KL` 99SMART,
`5285.KL` SDG, `8869.KL` PMETAL, `5296.KL` MRDIY (and the rest of the 30 in
batch).

### Paste table

| stockCode | yahooSymbol | shortName | fullName | sectorName | aliases |
| --- | --- | --- | --- | --- | --- |
| 5326 | 5326.KL | 99SMART | 99 Speed Mart Retail Holdings Berhad | Consumer Products & Services | 99SMART, 99 Speed Mart |
| 6888 | 6888.KL | AXIATA | Axiata Group Berhad | Telecommunications & Media | AXIATA, Axiata |
| 6947 | 6947.KL | CDB | CelcomDigi Berhad | Telecommunications & Media | CDB, CelcomDigi |
| 1023 | 1023.KL | CIMB | CIMB Group Holdings Berhad | Financial Services | CIMB, CIMB Group |
| 5398 | 5398.KL | GAMUDA | Gamuda Berhad | Construction | GAMUDA, Gamuda |
| 5819 | 5819.KL | HLBANK | Hong Leong Bank Berhad | Financial Services | HLBANK, Hong Leong Bank |
| 1082 | 1082.KL | HLFG | Hong Leong Financial Group Berhad | Financial Services | HLFG |
| 5225 | 5225.KL | IHH | IHH Healthcare Berhad | Health Care | IHH |
| 1961 | 1961.KL | IOICORP | IOI Corporation Berhad | Plantation | IOICORP, IOI |
| 2445 | 2445.KL | KLK | Kuala Lumpur Kepong Berhad | Plantation | KLK |
| 1155 | 1155.KL | MAYBANK | Malayan Banking Berhad | Financial Services | MAYBANK, Maybank, MBB |
| 6012 | 6012.KL | MAXIS | Maxis Berhad | Telecommunications & Media | MAXIS, Maxis |
| 3816 | 3816.KL | MISC | MISC Berhad | Transportation & Logistics | MISC |
| 5296 | 5296.KL | MRDIY | MR D.I.Y. Group (M) Berhad | Consumer Products & Services | MRDIY, MR DIY |
| 4707 | 4707.KL | NESTLE | Nestlé (Malaysia) Berhad | Consumer Products & Services | NESTLE, Nestle |
| 5183 | 5183.KL | PCHEM | PETRONAS Chemicals Group Berhad | Industrial Products & Services | PCHEM |
| 5681 | 5681.KL | PETDAG | PETRONAS Dagangan Berhad | Energy | PETDAG |
| 6033 | 6033.KL | PETGAS | PETRONAS Gas Berhad | Energy | PETGAS |
| 4065 | 4065.KL | PPB | PPB Group Berhad | Plantation | PPB |
| 8869 | 8869.KL | PMETAL | Press Metal Aluminium Holdings Berhad | Industrial Products & Services | PMETAL, Press Metal |
| 1295 | 1295.KL | PBBANK | Public Bank Berhad | Financial Services | PBBANK, Public Bank |
| 7084 | 7084.KL | QL | QL Resources Berhad | Consumer Products & Services | QL |
| 1066 | 1066.KL | RHBBANK | RHB Bank Berhad | Financial Services | RHBBANK, RHB |
| 4197 | 4197.KL | SIME | Sime Darby Berhad | Industrial Products & Services | SIME, Sime Darby |
| 5285 | 5285.KL | SDG | SD Guthrie Berhad | Plantation | SDG, SD Guthrie |
| 5211 | 5211.KL | SUNWAY | Sunway Berhad | Property | SUNWAY, Sunway |
| 4863 | 4863.KL | TM | Telekom Malaysia Berhad | Telecommunications & Media | TM, Telekom Malaysia |
| 5347 | 5347.KL | TENAGA | Tenaga Nasional Berhad | Utilities | TENAGA, TNB, Tenaga Nasional |
| 4677 | 4677.KL | YTL | YTL Corporation Berhad | Industrial Products & Services | YTL |
| 6742 | 6742.KL | YTLPOWR | YTL Power International Berhad | Utilities | YTLPOWR, YTL Power |

Count: **30**. Includes demo exemplar `1155`.

### Caveats for handoff / build

- Wikipedia is a convenient snapshot, not a licensed constituent feed. Before
  any non-private use, operator should diff against FTSE Russell / Bursa
  notices and PR-update the module (ticket 01).
- `fullName` / `sectorName` are curated for PoC UX; they need not match Bursa
  registry strings character-for-character.
- Nestlé display may use `Nestle` ASCII in UI if FE avoids special chars —
  either form is fine in seed.
