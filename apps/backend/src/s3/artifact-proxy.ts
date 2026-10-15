import { NotFoundException } from '@nestjs/common';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';

/** Where an AI worker claim-checked its rich artifact (persisted from the JobResult). */
export interface ArtifactPointer {
  readonly bucket: string;
  readonly key: string;
}

/**
 * Proxied read of a claim-checked artifact's JSON (ADR-0004 §4: NestJS
 * streams the object; no presigned URLs). The pointer is always one NestJS
 * itself persisted from a JobResult, never caller-supplied. An empty body is
 * a 404 (`emptyMessage`); S3 errors propagate. Not re-validated here: the
 * worker validates against the contract before writing (ADR-0014).
 */
export async function readArtifactJson(
  s3: S3Client,
  pointer: ArtifactPointer,
  emptyMessage: string,
): Promise<Record<string, unknown>> {
  const out = await s3.send(
    new GetObjectCommand({ Bucket: pointer.bucket, Key: pointer.key }),
  );
  const body = await out.Body?.transformToString('utf-8');
  if (!body) throw new NotFoundException(emptyMessage);
  return JSON.parse(body) as Record<string, unknown>;
}
