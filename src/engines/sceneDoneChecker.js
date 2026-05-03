/**
 * src/engines/sceneDoneChecker.js
 * Deterministic scene completion evaluator.
 * All thresholds, word lists, and verdicts loaded from devEditChecks.json.
 * No hardcoded arrays. UI-independent.
 */

import checks from "../knowledge/devEditChecks.json";

const {
  bodyWords: BODY,
  motionWords: MOTION,
  explanationFlags: EXPLAIN_FLAGS,
  stopSignals: STOP_SIGNALS,
  verdicts: VERDICTS,
  completionChecks: CHECK_DEFS,
} = checks;

export function checkSceneDone(text = "") {
  const clean = String(text || "").trim();
  const lower = clean.toLowerCase();
  const words = clean ? clean.split(/\s+/).length : 0;

  const bodyHits    = BODY.filter((w) => lower.includes(w)).length;
  const motionHits  = MOTION.filter((w) => lower.includes(w)).length;
  const explainHits = EXPLAIN_FLAGS.filter((w) => lower.includes(w)).length;
  const hasStop     = STOP_SIGNALS.some((w) => lower.includes(w));

  // Evaluate each check definition from JSON
  const evaluated = CHECK_DEFS.map((def) => {
    let pass = false;
    let detail = "";

    switch (def.type) {
      case "body_hit_count":
        pass = bodyHits >= def.threshold;
        detail = `${bodyHits} body word${bodyHits !== 1 ? "s" : ""} found`;
        break;
      case "motion_hit_count":
        pass = motionHits >= def.threshold;
        detail = `${motionHits} motion word${motionHits !== 1 ? "s" : ""} found`;
        break;
      case "word_count":
        pass = words >= def.threshold;
        detail = `${words} words`;
        break;
      case "explanation_flag_max":
        pass = explainHits <= def.threshold;
        detail = explainHits > 0 ? `${explainHits} explanation flag${explainHits !== 1 ? "s" : ""}` : "Clean";
        break;
      case "stop_signal_present":
        pass = hasStop;
        detail = hasStop ? "Stop signal found" : "Not yet";
        break;
      default:
        detail = "Unknown check type";
    }

    return { id: def.id, label: def.label, pass, detail, fix: def.fix };
  });

  const passed = evaluated.filter((c) => c.pass).length;

  let verdict = VERDICTS.keepGoing;
  if (passed >= 4 && hasStop) verdict = VERDICTS.likelyDone;
  if (passed === 5)            verdict = VERDICTS.done;

  return {
    verdict,
    words,
    passed,
    total: evaluated.length,
    checks: evaluated,
  };
}
