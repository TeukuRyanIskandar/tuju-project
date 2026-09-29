import { Controller, Get } from '@nestjs/common';

/**
 * Liveness / health endpoint (ADR-0010 §4). Compose healthchecks read it now; a
 * future ECS/ALB (ADR-0006 scale ladder) consumes the same endpoint. Deliberately
 * a plain liveness probe — deep dependency checks are a later addition.
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok'; at: string } {
    return { status: 'ok', at: new Date().toISOString() };
  }
}
