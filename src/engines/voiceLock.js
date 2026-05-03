/**
 * src/engines/voiceLock.js
 * Voice register detection and prohibited phrase checking.
 * Loads all rules from voiceRules.json. UI-independent.
 */

import voiceData from "../knowledge/voiceRules.json";
import { splitSentences } from "./ruleEngine.js";

export function runVoiceLock(text = "") {
  const lower = text.toLowerCase();
  const violations = [];

  for (const phrase of voiceData.prohibitedPhrases) {
    if (lower.includes(phrase.toLowerCase())) {
      violations.push({
        phrase,
        reason: "Prohibited voice construction — internal narration leaking into body-first prose.",
        fix: "Rewrite as physical fact. What does the body do instead?",
      });
    }
  }

  const pass = violations.length <= voiceData.passThreshold;
  const warn = !pass && violations.length <= voiceData.warningThreshold;

  return {
    type: "voice",
    label: "Voice Lock",
    pass,
    warn,
    violations,
    score: Math.max(0, 100 - violations.length * 20),
    summary: pass
      ? "Voice is clean."
      : `${violations.length} voice violation${violations.length !== 1 ? "s" : ""} detected.`,
  };
}

// Detect the likely register of a passage.
// bodyWords and stillnessWords are loaded from voiceRules.json.
export function detectRegister(text = "") {
  const sentences = splitSentences(text);
  if (!sentences.length) return null;

  const bodyWords = voiceData.bodyWords;
  const stillnessWords = voiceData.stillnessWords;

  const bodyCount = sentences.filter((s) => {
    const sl = s.toLowerCase();
    return bodyWords.some((w) => sl.includes(w));
  }).length;

  const stillCount = sentences.filter((s) => {
    const sl = s.toLowerCase();
    return stillnessWords.some((w) => sl.includes(w));
  }).length;

  const ratio = bodyCount / sentences.length;

  if (stillCount > sentences.length * 0.4) return voiceData.registers.find((r) => r.id === "aftermath");
  if (ratio >= 0.5) return voiceData.registers.find((r) => r.id === "body-first");
  return voiceData.registers.find((r) => r.id === "external");
}

export const REGISTERS = voiceData.registers;
