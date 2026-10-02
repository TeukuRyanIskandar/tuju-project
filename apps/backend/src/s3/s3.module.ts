import { Module } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';

/**
 * S3 wiring (ADR-0006: reached by env vars, never a hardcoded host — the
 * interface is identical across environments; only the target differs).
 *
 * The API process never talked to S3 before (ADR-0004: the Python worker
 * claim-checks analysis artifacts); this module exists for the prospectus
 * corpus seeding (spec 06, ticket 04) — the one place where NESTJS uploads
 * to S3: the curated, manually-stored prospectus PDFs the flagship
 * `analyze-prospectus` pipeline reads back. LocalStack locally (S3_ENDPOINT),
 * real S3/R2 in prod.
 */

/** DI token for the resolved S3 options. */
export const S3_OPTIONS = 'S3_OPTIONS';

/** DI token for the shared S3Client. */
export const S3_CLIENT = 'S3_CLIENT';

export interface S3Options {
  readonly bucket: string;
  readonly region: string;
  /** LocalStack endpoint locally; `undefined` in prod (real AWS). */
  readonly endpoint: string | undefined;
  readonly accessKeyId: string | undefined;
  readonly secretAccessKey: string | undefined;
}

/** Read the S3 settings from the environment (`.env.example` values). */
export function loadS3Options(env: NodeJS.ProcessEnv = process.env): S3Options {
  return {
    bucket: env.S3_BUCKET ?? 'tuju-local',
    region: env.AWS_REGION ?? 'ap-southeast-1',
    endpoint: env.S3_ENDPOINT || undefined,
    accessKeyId: env.AWS_ACCESS_KEY_ID || undefined,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY || undefined,
  };
}

@Module({
  providers: [
    { provide: S3_OPTIONS, useValue: loadS3Options() },
    {
      provide: S3_CLIENT,
      inject: [S3_OPTIONS],
      useFactory: (options: S3Options): S3Client =>
        new S3Client({
          region: options.region,
          endpoint: options.endpoint,
          // LocalStack serves buckets path-style; real AWS is virtual-hosted.
          forcePathStyle: options.endpoint !== undefined,
          credentials:
            options.accessKeyId && options.secretAccessKey
              ? {
                  accessKeyId: options.accessKeyId,
                  secretAccessKey: options.secretAccessKey,
                }
              : undefined,
        }),
    },
  ],
  exports: [S3_OPTIONS, S3_CLIENT],
})
export class S3Module {}
