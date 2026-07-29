/** Inaccuracy — band 2 of the severity scale. Thresholds come from config. */
import { QualityBandRule } from './quality-band';
import { Classification } from '../types';

export class InaccuracyRule extends QualityBandRule {
  readonly id = 'inaccuracy';
  readonly classification: Classification = 'Inaccuracy';
  protected readonly index = 2;
  protected readonly rank = 20;
  protected readonly reason = 'This lets some of the advantage slip.';
}
