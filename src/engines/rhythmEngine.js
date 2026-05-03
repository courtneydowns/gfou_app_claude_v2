/**
 * src/engines/rhythmEngine.js
 * Sentence rhythm and pacing analysis.
 * All thresholds and messages loaded from rhythmRules.json.
 * UI-independent.
 */

import rules from "../knowledge/rhythmRules.json";
import { splitSentences } from "./ruleEngine.js";

export function runRhythmCheck(text = "") {
  const sentences = splitSentences(text);

  if (sentences.length < rules.minSentencesForEval) {
    return {
      type: "rhythm",
      label: "Rhythm Check",
      pass: false,
      score: 0,
      avgWords: 0,
      stdDev: 0,
      variance: 0,
      longCount: 0,
      shortCount: 0,
      totalSentences: sentences.length,
      summary: rules.messages.tooFewSentences,
      motionCount: 0,
    };
  }

  const wordCounts = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
  const avg = wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;
  const variance =
    wordCounts.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / wordCounts.length;
  const stdDev = Math.sqrt(variance);

  const longCount  = wordCounts.filter((n) => n > rules.longSentenceWordThreshold).length;
  const shortCount = wordCounts.filter((n) => n <= rules.shortSentenceWordThreshold).length;

  const score = Math.min(
    rules.scoring.maxScore,
    Math.round(Math.min(stdDev * rules.scoring.stdDevWeight, rules.scoring.maxScore))
  );

  const tooManyLong = longCount > sentences.length * rules.maxLongSentenceRatio;
  const pass = stdDev >= rules.minStdDevForPass && !tooManyLong;

  // Motion word count using the JSON list
  const lower = text.toLowerCase();
  const motionCount = rules.motionWords.filter((w) => lower.includes(w)).length;

  let summary;
  if (pass) {
    summary = `${rules.messages.goodVariation} — avg ${Math.round(avg)} words, std dev ${stdDev.toFixed(1)}.`;
  } else if (tooManyLong) {
    summary = `${rules.messages.tooManyLong} (${longCount} long sentences detected)`;
  } else if (avg > rules.idealAverageWordRange.max) {
    summary = rules.messages.highAverage;
  } else {
    summary = rules.messages.lowVariation;
  }

  return {
    type: "rhythm",
    label: "Rhythm Check",
    pass,
    score,
    avgWords: Math.round(avg),
    stdDev: Math.round(stdDev * 10) / 10,
    variance: Math.round(variance),
    longCount,
    shortCount,
    motionCount,
    totalSentences: sentences.length,
    summary,
  };
}
