/**
 * src/engines/ruleEngine.js
 * Core V0 writing analysis engine.
 * Loads all rule data from src/knowledge/*.json — no hardcoded rule arrays here.
 * UI-independent: no React imports, no DOM access.
 */

import abstractionData from "../knowledge/abstractionPatterns.json";
import stuckData from "../knowledge/stuckPrompts.json";

// Build compiled regex patterns from JSON at module load time
const COMPILED_PATTERNS = abstractionData.patterns.map((p) => ({
  ...p,
  compiled: new RegExp(p.regex, p.flags),
}));

export const BODY_WORDS = abstractionData.bodyWords;
export const DONE_SIGNALS = abstractionData.doneSignals;

// ── Text utilities ────────────────────────────────────────────────

export function splitSentences(text = "") {
  return (
    String(text)
      .match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []
  )
    .map((s) => s.trim())
    .filter(Boolean);
}

function charIndexToSentenceNumber(sentences, charIndex) {
  let cursor = 0;
  for (let i = 0; i < sentences.length; i++) {
    const end = cursor + sentences[i].length;
    if (charIndex >= cursor && charIndex <= end + 2) return i + 1;
    cursor = end + 1;
  }
  return null;
}

function isDoneEnding(sentence = "") {
  const lower = sentence.toLowerCase().trim();
  return DONE_SIGNALS.some((sig) => lower.includes(sig));
}

// ── Scene-specific body alternatives ────────────────────────────
// Only uses the current scene's vocabulary — no cross-scene data.

export function getBodyAlternatives(sentence = "", scene = {}) {
  const lower = sentence.toLowerCase();

  // Strictly scene-specific vocabulary only
  const vocab = [
    ...(Array.isArray(scene.start_here) ? scene.start_here : []),
    ...(Array.isArray(scene.stuck_options) ? scene.stuck_options : []),
  ]
    .map(String)
    .filter(Boolean);

  if (!vocab.length) return [];

  const matches = vocab.filter((opt) => {
    const ol = opt.toLowerCase();
    if (lower.includes("close"))
      return ol.includes("close") || ol.includes("tight") || ol.includes("lock");
    if (lower.includes("still") || lower.includes("stop"))
      return ol.includes("still") || ol.includes("does not move");
    return BODY_WORDS.some((w) => lower.includes(w) && ol.includes(w));
  });

  return (matches.length ? matches : vocab).slice(0, 4);
}

// ── Main analysis ────────────────────────────────────────────────

export function analyzeV0Text(text = "", scene = {}) {
  const findings = [];
  const sentences = splitSentences(text);

  // Abstraction / labeling patterns — from JSON
  for (const rule of COMPILED_PATTERNS) {
    // Reset lastIndex for global regexes
    rule.compiled.lastIndex = 0;
    for (const match of [...String(text).matchAll(rule.compiled)]) {
      const sn = charIndexToSentenceNumber(sentences, match.index);
      findings.push({
        type: "abstraction",
        word: match[0],
        index: match.index,
        sentenceNumber: sn,
        sentenceText: sn ? sentences[sn - 1] : "",
        reason: rule.reason,
        fix: rule.fix,
        // Alternatives use ONLY this scene's vocabulary
        alternatives: getBodyAlternatives(sn ? sentences[sn - 1] : "", scene),
      });
    }
  }

  // Body drift and compression checks
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const lower = s.toLowerCase();
    const hasBody = BODY_WORDS.some((w) => lower.includes(w));
    const wc = s.split(/\s+/).length;

    if (!hasBody && s.length > 0) {
      findings.push({
        type: "body_check",
        word: `Sentence ${i + 1}`,
        sentenceNumber: i + 1,
        sentenceText: s,
        reason: "drifting away from the body",
        fix: "Choose a scene-matched physical alternative.",
        alternatives: getBodyAlternatives(s, scene),
      });
    }

    if (wc > abstractionData.compressionThreshold) {
      findings.push({
        type: "compression",
        word: `Sentence ${i + 1}`,
        sentenceNumber: i + 1,
        sentenceText: s,
        reason: `long sentence (${wc} words) — may be explaining`,
        fix: "Split into short physical beats.",
        alternatives: getBodyAlternatives(s, scene),
      });
    }
  }

  return findings;
}

// ── Forward directive ────────────────────────────────────────────

export function getForwardDirective(text = "") {
  const clean = text.trim();
  if (!clean) return `NEXT: ${stuckData.emptyStateDirective}`;

  const sentences = splitSentences(clean);
  const last = sentences[sentences.length - 1] || "";

  if (isDoneEnding(last)) return `DONE: ${stuckData.doneDirective}`;

  const lower = last.toLowerCase();
  for (const { trigger, directive } of stuckData.forwardDirectives) {
    if (lower.includes(trigger)) return `NEXT: ${directive}`;
  }

  return `NEXT: ${stuckData.defaultDirective}`;
}
