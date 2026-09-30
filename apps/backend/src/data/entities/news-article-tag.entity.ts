import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Company } from './company.entity';
import { NewsArticle } from './news-article.entity';

/**
 * The many-to-many link between a {@link NewsArticle} and a {@link Company}
 * (spec 01; tagging logic owned by spec 04).
 *
 * Produced by matching the headline against the company's alias set
 * (`shortName`/`fullName`/curated `aliases`). Deterministic (not an AI job); one
 * article may tag several companies. Modelled as an explicit join entity (rather
 * than an implicit `@ManyToMany` join table) so a match can later carry metadata
 * (matched alias, confidence) without a reshape.
 */
@Entity({ name: 'news_article_tags' })
@Unique('UQ_news_article_tags_article_company', ['newsArticleId', 'companyId'])
export class NewsArticleTag {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => NewsArticle, (article) => article.tags, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'news_article_id' })
  newsArticle!: NewsArticle;

  @Index()
  @Column({ type: 'uuid', name: 'news_article_id' })
  newsArticleId!: string;

  @ManyToOne(() => Company, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Index()
  @Column({ type: 'uuid', name: 'company_id' })
  companyId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
