import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from './config';

/**
 * Global config module — resolves the connection-URL-by-env config once
 * (ADR-0006) and makes it injectable everywhere via the APP_CONFIG token.
 */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: loadConfig }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
