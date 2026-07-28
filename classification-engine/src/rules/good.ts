/** Good — a reasonable move that keeps the position healthy. */
import { ClassifierConfig } from '../config';
import { QualityBandRule } from './quality-band';
import { Classification } from '../types';

export class GoodRule extends QualityBandRule {
  readonly id = 'good';
  readonly classification: Classification = 'Good';
  protected readonly rank = 30;
  protected readonly reason = 'A reasonable move that keeps the position healthy.';
  protected lowerBound(c: ClassifierConfig): number { return c.quality.excellent; }
  protected upperBound(c: ClassifierConfig): number { return c.quality.good; }
}
