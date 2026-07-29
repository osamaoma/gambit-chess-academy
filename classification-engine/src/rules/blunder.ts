/**
 * Blunder — the last band, and the only one with no ceiling.
 *
 * Its open top is what guarantees the rule set is exhaustive: any move past
 * every configured threshold lands here, so the engine can never fail to
 * answer whatever the thresholds are tuned to.
 */
import { QualityBandRule } from './quality-band';
import { Classification } from '../types';

export class BlunderRule extends QualityBandRule {
  readonly id = 'blunder';
  readonly classification: Classification = 'Blunder';
  protected readonly index = 4;
  protected readonly rank = 5;
  protected readonly reason = 'This changes the outcome of the game.';
}
