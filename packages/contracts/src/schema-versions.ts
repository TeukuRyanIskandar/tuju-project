export const SCHEMA_VERSIONS = {
  technical: 'technical-analysis-1',
  fundamental: 'fundamental-analysis-2',
  prospectus: 'prospectus-at-a-glance-1',
  prospectusparse: 'prospectus-parse-1',
  brief: 'brief-1',
  announcementsummary: 'announcement-summary-1',
  stub: 'stub-1',
} as const;

export type SchemaVersionKey = keyof typeof SCHEMA_VERSIONS;
export type SchemaVersion = typeof SCHEMA_VERSIONS[SchemaVersionKey];
