/** Good — band 1 of the severity scale. Thresholds come from config. */
import { QualityBandRule } from './quality-band';
import { Classification } from '../types';

export class GoodRule extends QualityBandRule {
  readonly id = 'good';
  readonly classification: Classification = 'Good';
  protected readonly index = 1;
  protected readonly rank = 30;
  protected readonly reason = 'A reasonable move that keeps the position healthy.';
}
