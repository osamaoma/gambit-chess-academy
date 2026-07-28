/** Mistake — a serious part of the position is given up. */
import { ClassifierConfig } from '../config';
import { QualityBandRule } from './quality-band';
import { Classification } from '../types';

export class MistakeRule extends QualityBandRule {
  readonly id = 'mistake';
  readonly classification: Classification = 'Mistake';
  protected readonly rank = 10;
  protected readonly reason = 'This gives up a serious part of the position.';
  protected lowerBound(c: ClassifierConfig): number { return c.quality.inaccuracy; }
  protected upperBound(c: ClassifierConfig): number { return c.quality.mistake; }
}
