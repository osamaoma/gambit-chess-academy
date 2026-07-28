/**
 * Blunder — the last band, and the only one with no ceiling.
 *
 * Its open top is what guarantees the rule set is exhaustive: every move that
 * no other rule claims lands here, so the engine can never fail to answer.
 */
import { ClassifierConfig } from '../config';
import { QualityBandRule } from './quality-band';
import { Classification } from '../types';

export class BlunderRule extends QualityBandRule {
  readonly id = 'blunder';
  readonly classification: Classification = 'Blunder';
  protected readonly rank = 5;
  protected readonly reason = 'This changes the outcome of the game.';
  protected lowerBound(c: ClassifierConfig): number { return c.quality.mistake; }
  protected upperBound(): number { return Infinity; }
}
