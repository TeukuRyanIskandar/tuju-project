import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  StockTechnicalAnalysisArtifact,
  StockFundamentalAnalysisArtifact,
  TechnicalAnalysisArtifact,
  FundamentalAnalysisArtifact,
  buildJsonSchema,
} from '../src/index.js';

describe('browser analysis artifacts', () => {
  it('leaves the committed cross-language JSON Schema unchanged', () => {
    const schema = JSON.parse(readFileSync(new URL('../schema/contracts.schema.json', import.meta.url), 'utf8'));
    expect(buildJsonSchema()).toEqual(schema);
  });
  for (const [kind, browser, stored] of [
    ['technical', StockTechnicalAnalysisArtifact, TechnicalAnalysisArtifact],
    ['fundamental', StockFundamentalAnalysisArtifact, FundamentalAnalysisArtifact],
  ] as const) {
    it(`${kind}: proxy body omits cost without weakening stored artifacts/codegen`, () => {
      const fixture = JSON.parse(readFileSync(new URL(`../fixtures/${kind}-analysis-artifact.json`, import.meta.url), 'utf8'));
      const { cost: _cost, ...body } = fixture;
      expect(browser.parse(body)).toEqual(body);
      expect(browser.safeParse(fixture).success).toBe(false);
      expect(stored.safeParse(body).success).toBe(false);
      expect(stored.safeParse(fixture).success).toBe(true);
      expect(browser.meta()?.id).toBeUndefined();
      expect(JSON.stringify(buildJsonSchema())).not.toContain(`Stock${kind === 'technical' ? 'Technical' : 'Fundamental'}AnalysisArtifact`);
    });
  }
});
