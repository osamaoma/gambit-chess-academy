/** Inaccuracy — some of the advantage slips. */
import { ClassifierConfig } from '../config';
import { QualityBandRule } from './quality-band';
import { Classification } from '../types';

export class InaccuracyRule extends QualityBandRule {
  readonly id = 'inaccuracy';
  readonly classification: Classification = 'Inaccuracy';
  protected readonly rank = 20;
  protected readonly reason = 'This lets some of the advantage slip.';
  protected lowerBound(c: ClassifierConfig): number { return c.quality.good; }
  protected upperBound(c: ClassifierConfig): number { return c.quality.inaccuracy; }
}
