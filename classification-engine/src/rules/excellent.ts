/** Excellent — band 0 of the severity scale. Thresholds come from config. */
import { QualityBandRule } from './quality-band';
import { Classification } from '../types';

export class ExcellentRule extends QualityBandRule {
  readonly id = 'excellent';
  readonly classification: Classification = 'Excellent';
  protected readonly index = 0;
  protected readonly rank = 40;
  protected readonly reason = 'Almost as good as the top choice.';
}
