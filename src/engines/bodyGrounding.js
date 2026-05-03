import { splitSentences, BODY_WORDS } from "./ruleEngine.js";

export function analyzeBodyGrounding(text) {
  const sentences = splitSentences(text);
  const bodySentences = sentences.filter((s) =>
    BODY_WORDS.some((w) => s.toLowerCase().includes(w))
  ).length;
  const totalSentences = sentences.length;
  const ratio = totalSentences ? bodySentences / totalSentences : 0;
  const pass = totalSentences > 0 && ratio >= 0.6;

  return {
    pass,
    score: Math.round(ratio * 100),
    bodySentences,
    totalSentences,
    ratio,
  };
}
