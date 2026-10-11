import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSchemaDecorators1728350000000 implements MigrationInterface {
  name = 'AddSchemaDecorators1728350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_technical_analyses_instrument_id" ON "technical_analyses" ("instrument_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fundamental_analyses_instrument_id" ON "fundamental_analyses" ("instrument_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_watchlist_user_id" ON "watchlists" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_watchlist_user_id"`);
    await queryRunner.query(`DROP INDEX "IDX_fundamental_analyses_instrument_id"`);
    await queryRunner.query(`DROP INDEX "IDX_technical_analyses_instrument_id"`);
  }
}
