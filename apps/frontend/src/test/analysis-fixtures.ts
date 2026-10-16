import {
  ProspectusArtifact,
  StockFundamentalAnalysisArtifact,
  StockTechnicalAnalysisArtifact,
  type StockFundamentalAnalysisResponse,
  type StockTechnicalAnalysisResponse,
} from '@tuju/contracts'
import technicalJson from '@tuju/contracts/fixtures/technical-analysis-artifact.json?raw'
import fundamentalJson from '@tuju/contracts/fixtures/fundamental-analysis-artifact.json?raw'
import prospectusJson from '@tuju/contracts/fixtures/prospectus-artifact.json?raw'

function publicBody(raw: string) {
  const { cost: _cost, ...body } = JSON.parse(raw)
  return body
}

export const technical = StockTechnicalAnalysisArtifact.parse(publicBody(technicalJson))
export const fundamental = StockFundamentalAnalysisArtifact.parse(publicBody(fundamentalJson))
export const prospectus = ProspectusArtifact.parse(JSON.parse(prospectusJson))

const common = {
  code: '1155', status: 'ready', headline: 'Stored summary',
  artifact: { bucket: 'private-bucket', key: 'private-key' },
  artifactPath: '/private-pointer', errorMessage: null,
} as const

export const technicalSummary: StockTechnicalAnalysisResponse = {
  ...common, jobName: 'analyze-technical', asOf: new Date(technical.asOf).toISOString(),
}
export const fundamentalSummary: StockFundamentalAnalysisResponse = {
  ...common, jobName: 'analyze-fundamental', asOf: new Date(fundamental.asOf).toISOString(),
}
