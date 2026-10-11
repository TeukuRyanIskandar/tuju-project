import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataModule } from '../data/data.module';
import { CacheModule } from '../cache/cache.module';
import { JobBusModule } from '../jobbus/job-bus.module';
import { S3Module } from '../s3/s3.module';
import { ProspectusAnalysis } from '../data/entities/prospectus-analysis.entity';
import { ShariahStatus } from '../data/entities/shariah-status.entity';
import { Company } from '../data/entities/company.entity';
import { IpoListing } from '../data/entities/ipo-listing.entity';
import { IpoController } from './ipo.controller';
import { IpoService } from './ipo.service';
import { ProspectusAnalysisStore } from './prospectus-analysis.store';

@Module({
  imports: [
    DataModule,
    CacheModule,
    JobBusModule,
    S3Module,
    TypeOrmModule.forFeature([
      ProspectusAnalysis,
      ShariahStatus,
      Company,
      IpoListing,
    ]),
  ],
  controllers: [IpoController],
  providers: [IpoService, ProspectusAnalysisStore],
})
export class IpoModule {}
