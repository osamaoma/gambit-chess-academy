/**
 * The standard rule set — one rule per classification.
 *
 * Order here is irrelevant: the engine sorts by each rule's own `priority()`.
 * The list is exported so a host can start from it and add, drop or replace
 * rules without rebuilding it from scratch.
 */

import { ClassificationRule } from '../rule';
import { BookRule } from './book';
import { ForcedRule } from './forced';
import { BrilliantRule } from './brilliant';
import { GreatRule } from './great';
import { MissRule } from './miss';
import { BestRule } from './best';
import { ExcellentRule } from './excellent';
import { GoodRule } from './good';
import { InaccuracyRule } from './inaccuracy';
import { MistakeRule } from './mistake';
import { BlunderRule } from './blunder';

export function defaultRules(): ClassificationRule[] {
  return [
    new BookRule(),       // 100
    new ForcedRule(),     //  90
    new BrilliantRule(),  //  80
    new GreatRule(),      //  70
    new MissRule(),       //  60
    new BestRule(),       //  50
    new ExcellentRule(),  //  40 ─┐
    new GoodRule(),       //  30  │ mutually exclusive win%-loss bands;
    new InaccuracyRule(), //  20  │ together they cover every move, which is
    new MistakeRule(),    //  10  │ what makes the set exhaustive.
    new BlunderRule(),    //   5 ─┘
  ];
}

export { BookRule } from './book';
export { ForcedRule } from './forced';
export { BrilliantRule } from './brilliant';
export { GreatRule } from './great';
export { MissRule } from './miss';
export { BestRule } from './best';
export { ExcellentRule } from './excellent';
export { GoodRule } from './good';
export { InaccuracyRule } from './inaccuracy';
export { MistakeRule } from './mistake';
export { BlunderRule } from './blunder';
export { QualityBandRule, bandConfidence } from './quality-band';
