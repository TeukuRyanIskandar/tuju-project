import { IsIn, IsOptional, IsString } from 'class-validator';

export class AnalysisRequestDto {
  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  timeframe?: string;

  @IsOptional()
  @IsIn(['quarterly', 'annual'])
  period?: string;
}
