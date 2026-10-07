import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { DataSource } from 'typeorm';
import { Company } from '../data/entities/company.entity';
import { IpoListing } from '../data/entities/ipo-listing.entity';
import { ProspectusAnalysis } from '../data/entities/prospectus-analysis.entity';
import { ShariahStatus } from '../data/entities/shariah-status.entity';
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
    private readonly dataSource: DataSource,
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
    const shariah = await this.dataSource
      .getRepository(ShariahStatus)
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
   * Proxied read of the rich artifact JSON from S3 (ADR-0004 §4: NestJS
   * streams the object; no presigned URLs). The pointer is the one NestJS
   * itself persisted from the JobResult, never caller-supplied.
   */
  async getArtifact(prospectusId: string): Promise<unknown> {
    const { analysis } = await this.findAnalysed(prospectusId);
    const out = await this.s3.send(
      new GetObjectCommand({
        Bucket: analysis.artifactBucket,
        Key: analysis.artifactKey,
      }),
    );
    const body = await out.Body?.transformToString('utf-8');
    if (!body) {
      throw new NotFoundException(
        `Prospectus artifact body is empty for id=${prospectusId}`,
      );
    }
    return JSON.parse(body) as unknown;
  }

  private findListing(prospectusId: string): Promise<IpoListing | null> {
    if (!isUuid(prospectusId)) return Promise.resolve(null);
    return this.dataSource
      .getRepository(IpoListing)
      .findOne({ where: { id: prospectusId } });
  }

  private async findAnalysed(
    prospectusId: string,
  ): Promise<{ listing: IpoListing; analysis: ProspectusAnalysis }> {
    const listing = await this.findListing(prospectusId);
    const analysis = listing
      ? await this.dataSource
          .getRepository(ProspectusAnalysis)
          .findOne({ where: { prospectusId } })
      : null;
    if (!listing || !analysis) {
      throw new NotFoundException(
        `No prospectus analysis yet for id=${prospectusId}`,
      );
    }
    return { listing, analysis };
  }
}
