/** Mistake — band 3 of the severity scale. Thresholds come from config. */
import { QualityBandRule } from './quality-band';
import { Classification } from '../types';

export class MistakeRule extends QualityBandRule {
  readonly id = 'mistake';
  readonly classification: Classification = 'Mistake';
  protected readonly index = 3;
  protected readonly rank = 10;
  protected readonly reason = 'This gives up a serious part of the position.';
}
