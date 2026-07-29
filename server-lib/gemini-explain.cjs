"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/server-entry.ts
var server_entry_exports = {};
__export(server_entry_exports, {
  DEFAULT_PARSER_CONFIG: () => DEFAULT_PARSER_CONFIG,
  DEFAULT_PROMPT_CONFIG: () => DEFAULT_PROMPT_CONFIG,
  GeminiError: () => GeminiError,
  buildSystemInstruction: () => buildSystemInstruction,
  buildUserPromptFromFacts: () => buildUserPromptFromFacts,
  parseExplanation: () => parseExplanation
});
module.exports = __toCommonJS(server_entry_exports);

// src/explanation/prompt-builder.ts
var DEFAULT_PROMPT_CONFIG = {
  maxWords: 80,
  recentSummaryWindow: 6
};
function buildSystemInstruction(config = DEFAULT_PROMPT_CONFIG) {
  return [
    "You are a world-class chess coach writing a one-line note for a student reviewing their game.",
    "",
    "YOUR ONLY JOB is to turn the structured analysis you are given into natural coaching language.",
    "All chess analysis is already complete and correct. You must not question it, re-analyse the",
    "position, or add chess claims of your own. If a fact is not in the report, do not state it.",
    "",
    "RULES:",
    `- Stay under ${config.maxWords} words. Two short sentences is ideal.`,
    "- When a better move is given, say what THAT move would have achieved, naming the piece and",
    '  square, and what the move played missed or allowed. Never just say "there was a better move".',
    "- When the student found the best move, say what their move achieves.",
    '- Write to the student as "you", and call the opponent "your opponent".',
    "- Plain English a beginner can follow. No jargon they would have to look up.",
    "- Never mention engines, evaluations, centipawns, scores, numbers of any kind, or that a computer",
    '  was involved. Never use the words "engine", "Stockfish", "eval", "centipawn" or "analysis".',
    '- Never mention the classification label itself (do not write "this was an inaccuracy").',
    "- Be encouraging and matter-of-fact. Never sarcastic, never scolding.",
    "- Vary your phrasing. Do not begin consecutive notes the same way.",
    "- Output the note only: no preamble, no bullet points, no markdown, no quotation marks."
  ].join("\n");
}
function buildUserPromptFromFacts(f, config = DEFAULT_PROMPT_CONFIG) {
  const lines = [];
  const add = (label, value) => {
    if (value) lines.push(`${label}: ${value}`);
  };
  const list = (v) => v && v.length ? v.join(", ") : null;
  add("Move played", f.played);
  add("Verdict", f.verdict);
  add("Game phase", f.phase);
  if (f.best) {
    add("A better move existed", f.best);
    add("The better move moves the", f.bestPiece);
    add("It lands on", f.bestTo);
    add("What that better move achieves", list(f.bestIdeas));
    if (f.samePieceWrongSquare) add("Note", "the student chose the right piece but the wrong square");
    if (f.bestCaptures) add("The better move", "wins material");
    if (f.bestGivesCheck) add("The better move", "gives check");
    lines.push("");
    lines.push("Explain what the better move would have achieved, and what the played move missed.");
  } else {
    add("Note", "the student found the best move; explain what it achieves");
  }
  add("Tactics in the move played", list(f.playedMotifs));
  add("Tactics available but missed", list(f.missedMotifs));
  add("Strategic themes", list(f.themes));
  add("What the position calls for", list(f.priorities));
  add("Open files", list(f.openFiles));
  const recent = (f.recentSummaries ?? []).slice(-config.recentSummaryWindow);
  if (recent.length > 0) {
    lines.push("");
    lines.push("Notes you already wrote earlier in this review \u2014 do NOT reuse their wording or openings:");
    for (const r of recent) lines.push(`- ${r}`);
  }
  lines.push("");
  lines.push(`Write the coaching note now, under ${config.maxWords} words.`);
  return lines.join("\n");
}

// src/explanation/errors.ts
var GeminiError = class extends Error {
  kind;
  status;
  /** Should a retry be attempted at all? */
  retryable;
  constructor(kind, message, status) {
    super(message);
    this.name = "GeminiError";
    this.kind = kind;
    this.status = status;
    this.retryable = kind === "rate-limit" || kind === "server" || kind === "network" || kind === "validation";
  }
};

// src/explanation/response-parser.ts
var DEFAULT_PARSER_CONFIG = {
  maxWords: 80,
  bannedTerms: ["stockfish", "centipawn", "centipawns", "engine", "eval", "evaluation", "cp loss"]
};
function parseExplanation(raw, config = DEFAULT_PARSER_CONFIG) {
  let text = raw.trim();
  text = text.replace(/^```[a-z]*\s*|\s*```$/gi, "").trim();
  text = text.replace(/^(here'?s?|sure|certainly)[^:]{0,40}:\s*/i, "").trim();
  text = text.replace(/^[*_>#\s-]+/, "").replace(/[*_`]/g, "").trim();
  if (/^["'"].*["'"]$/s.test(text)) text = text.slice(1, -1).trim();
  text = text.replace(/\s+/g, " ");
  if (!text) throw new GeminiError("validation", "Note was empty after cleaning.");
  const lower = text.toLowerCase();
  for (const term of config.bannedTerms) {
    if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower)) {
      throw new GeminiError("validation", `Note mentioned a forbidden term: "${term}".`);
    }
  }
  const words = text.split(/\s+/);
  if (words.length <= config.maxWords) return { summary: text, truncated: false };
  const clipped = words.slice(0, config.maxWords).join(" ");
  const lastStop = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf("!"), clipped.lastIndexOf("?"));
  const summary = lastStop > 40 ? clipped.slice(0, lastStop + 1) : `${clipped.replace(/[,;:]$/, "")}\u2026`;
  return { summary, truncated: true };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_PARSER_CONFIG,
  DEFAULT_PROMPT_CONFIG,
  GeminiError,
  buildSystemInstruction,
  buildUserPromptFromFacts,
  parseExplanation
});
