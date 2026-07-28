/** Excellent — practically as good as the top choice. */
import { ClassifierConfig } from '../config';
import { QualityBandRule } from './quality-band';
import { Classification } from '../types';

export class ExcellentRule extends QualityBandRule {
  readonly id = 'excellent';
  readonly classification: Classification = 'Excellent';
  protected readonly rank = 40;
  protected readonly reason = 'Almost as good as the top choice.';
  protected lowerBound(): number { return -Infinity; }        // the first band
  protected upperBound(c: ClassifierConfig): number { return c.quality.excellent; }
}
