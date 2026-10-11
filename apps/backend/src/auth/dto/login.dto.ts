import { IsOptional, IsUUID, IsEnum } from 'class-validator';
import type { Tier } from '../tier-policy';
import { TIER_ALLOWED_JOBS } from '../tier-policy';

const TIER_VALUES = Object.keys(TIER_ALLOWED_JOBS) as Tier[];

export class LoginRequestDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsEnum(TIER_VALUES)
  tier?: Tier;
}
