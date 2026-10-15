import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { S3Client } from '@aws-sdk/client-s3';
import { Repository } from 'typeorm';
import type { ProspectusArtifact } from '@tuju/contracts';
import { Company } from '../data/entities/company.entity';
import { IpoListing } from '../data/entities/ipo-listing.entity';
import { ProspectusAnalysis } from '../data/entities/prospectus-analysis.entity';
import { ShariahStatus } from '../data/entities/shariah-status.entity';
import { readArtifactJson } from '../s3/artifact-proxy';
import { S3_CLIENT } from '../s3/s3.module';
import { isUuid } from '../stocks/filters';
import {
  toAtAGlance,
  toReference,
  type IpoReferenceResponse,
  type ProspectusAtAGlanceResponse,
} from './ipo.mapping';

/**
 * Read projections over `IpoListing` for the spec-06 prospectus at-a-glance
 * (ticket 05): the worker-facing reference row and the public at-a-glance.
 * Pure reads — the only writer is `ProspectusAnalysisStore` (ADR-0004).
 */
@Injectable()
export class IpoService {
  constructor(
    @InjectRepository(ShariahStatus)
    private readonly shariahStatusRepo: Repository<ShariahStatus>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(IpoListing)
    private readonly ipoListingRepo: Repository<IpoListing>,
    @InjectRepository(ProspectusAnalysis)
    private readonly prospectusAnalysisRepo: Repository<ProspectusAnalysis>,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
  ) {}

  /**
   * The IPO reference row the Python worker needs. 404 for a malformed/unknown
   * id OR an IPO with no stored prospectus (nothing for the worker to analyse).
   *
   * Shariah: `IpoListing` has no FK to `Company` (the issuer may not be in the
   * analysed universe yet), so the current status is resolved by a
   * case-insensitive match of the listing's `companyName` against
   * `Company.fullName`, latest `effectiveDate` wins. No match ⇒ `null`.
   */
  async getReference(prospectusId: string): Promise<IpoReferenceResponse> {
    const listing = await this.findListing(prospectusId);
    if (!listing || !listing.prospectusS3Key) {
      throw new NotFoundException(
        `No IPO with a stored prospectus found for id=${prospectusId}`,
      );
    }
    const shariah = await this.shariahStatusRepo
      .createQueryBuilder('s')
      .innerJoin(Company, 'c', 'c.id = s.company_id')
      .where('lower(trim(c.full_name)) = lower(trim(:name))', {
        name: listing.companyName,
      })
      .orderBy('s.effective_date', 'DESC')
      .limit(1)
      .getOne();
    return toReference(listing, shariah?.status ?? null);
  }

  /** Listing ⋈ thin analysis row; 404 before an analysis has landed. */
  async getAtAGlance(prospectusId: string): Promise<ProspectusAtAGlanceResponse> {
    const { listing, analysis } = await this.findAnalysed(prospectusId);
    return toAtAGlance(listing, analysis);
  }

  /**
   * Proxied read of the rich artifact JSON (shared `readArtifactJson`), typed
   * as the contract. Unlike the stock-analysis artifacts, `cost` is kept.
   */
  async getArtifact(prospectusId: string): Promise<ProspectusArtifact> {
    const { analysis } = await this.findAnalysed(prospectusId);
    return (await readArtifactJson(
      this.s3,
      { bucket: analysis.artifactBucket, key: analysis.artifactKey },
      `Prospectus artifact body is empty for id=${prospectusId}`,
    )) as unknown as ProspectusArtifact;
  }

  private findListing(prospectusId: string): Promise<IpoListing | null> {
    if (!isUuid(prospectusId)) return Promise.resolve(null);
    return this.ipoListingRepo.findOne({ where: { id: prospectusId } });
  }

  private async findAnalysed(
    prospectusId: string,
  ): Promise<{ listing: IpoListing; analysis: ProspectusAnalysis }> {
    const listing = await this.findListing(prospectusId);
    const analysis = listing
      ? await this.prospectusAnalysisRepo.findOne({
          where: { prospectusId },
        })
      : null;
    if (!listing || !analysis) {
      throw new NotFoundException(
        `No prospectus analysis yet for id=${prospectusId}`,
      );
    }
    return { listing, analysis };
  }
}
