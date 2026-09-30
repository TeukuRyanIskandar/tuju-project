import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { IngestionRun } from './ingestion-run.entity';
import { NewsArticleTag } from './news-article-tag.entity';

/**
 * Third-party media coverage (spec 01; tagging owned by spec 04). Not an official
 * disclosure. Stored as headline + link + source + publish time only (no body).
 *
 * Tagged to companies in-house by a deterministic conservative whole-word alias
 * match (see {@link NewsArticleTag}); an article matching no company is
 * market-level news.
 */
@Entity({ name: 'news_articles' })
export class NewsArticle {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 512 })
  headline!: string;

  /** Canonical article URL. Unique so re-ingesting the RSS feed is idempotent. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 1024 })
  url!: string;

  /** Publisher name (RSS feed title). */
  @Column({ type: 'varchar', length: 128 })
  source!: string;

  @Index()
  @Column({ type: 'timestamptz', name: 'published_at' })
  publishedAt!: Date;

  @OneToMany(() => NewsArticleTag, (tag) => tag.newsArticle)
  tags!: NewsArticleTag[];

  @ManyToOne(() => IngestionRun, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ingestion_run_id' })
  ingestionRun!: IngestionRun;

  @Index()
  @Column({ type: 'uuid', name: 'ingestion_run_id' })
  ingestionRunId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
