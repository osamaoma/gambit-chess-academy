/**
 * Module 9 — PositionContextDetector.
 *
 * Answers "what kind of position is this?" WITHOUT looking at the move. Phase,
 * material, open files and whether the kings have moved are facts about the
 * board, and several later modules need them; deriving them once here stops
 * the theme detector, the writer and the visual generators each recomputing
 * their own slightly different version.
 */

import { fileIndex, kingOnHome, parseFen, PIECE_VALUES } from '@gambit/explanation-engine';
import type { Board } from '@gambit/explanation-engine';
import type { Color, GamePhase, PositionContext, PositionContextDetector } from './types';

/** Thresholds for the phase call, in centipawns of non-pawn material. */
export interface PhaseConfig {
  /** At or below this, the game is an endgame. */
  readonly endgameBelow: number;
  /** Before this ply the game is still the opening (unless material says otherwise). */
  readonly openingUntilPly: number;
}

export const DEFAULT_PHASE_CONFIG: PhaseConfig = {
  endgameBelow: 2600,
  openingUntilPly: 20,
};

const FILES = 'abcdefgh';

export class DefaultPositionContextDetector implements PositionContextDetector {
  constructor(private readonly config: PhaseConfig = DEFAULT_PHASE_CONFIG) {}

  detect(fen: string, mover: Color): PositionContext {
    const board = parseFen(fen);
    const ply = plyOf(fen);

    let white = 0;
    let black = 0;
    let nonPawnMaterial = 0;
    // Pawn counts per file, per colour — the basis for open/half-open files.
    const pawns: Record<Color, number[]> = { white: new Array(8).fill(0), black: new Array(8).fill(0) };

    for (const [square, piece] of board.squares) {
      const value = PIECE_VALUES[piece.type] * 100;
      if (piece.color === 'white') white += value; else black += value;
      if (piece.type !== 'p' && piece.type !== 'k') nonPawnMaterial += value;
      if (piece.type === 'p') pawns[piece.color][fileIndex(square)]!++;
    }

    const openFiles: string[] = [];
    const halfOpenFiles: string[] = [];
    for (let f = 0; f < 8; f++) {
      const w = pawns.white[f]!;
      const b = pawns.black[f]!;
      if (w === 0 && b === 0) openFiles.push(FILES[f]!);
      else if ((mover === 'white' ? w : b) === 0) halfOpenFiles.push(FILES[f]!);
    }

    return {
      phase: this.phaseOf(nonPawnMaterial, ply),
      material: { white, black, moverNet: mover === 'white' ? white - black : black - white },
      openFiles,
      halfOpenFiles,
      kingsOnHome: { white: safeKingHome(board, 'white'), black: safeKingHome(board, 'black') },
      nonPawnMaterial,
      ply,
    };
  }

  /**
   * Material decides the endgame, not move number: a queenless position on move
   * 15 is an endgame, and a full-board position on move 40 is not.
   */
  private phaseOf(nonPawnMaterial: number, ply: number): GamePhase {
    if (nonPawnMaterial <= this.config.endgameBelow) return 'endgame';
    if (ply <= this.config.openingUntilPly) return 'opening';
    return 'middlegame';
  }
}

function safeKingHome(board: Board, color: Color): boolean {
  try { return kingOnHome(board, color); } catch { return false; }
}

/** Ply from a FEN's fullmove counter and side to move. */
export function plyOf(fen: string): number {
  const parts = (fen ?? '').split(/\s+/);
  const fullmove = Number(parts[5] ?? 1) || 1;
  return (fullmove - 1) * 2 + (parts[1] === 'b' ? 2 : 1);
}
