/**
 * src/engines/devEditor.js
 * Developmental editor pass — runs abstraction, body, and completion checks
 * and assembles a structured editorial report.
 * Loads all data from knowledge JSON. UI-independent.
 */

import devData from "../knowledge/devEditChecks.json";
import { analyzeV0Text, splitSentences, BODY_WORDS } from "./ruleEngine.js";
import { analyzeBodyGrounding } from "./bodyGrounding.js";
import { checkSceneDone } from "./sceneDoneChecker.js";

// ── Abstraction report ───────────────────────────────────────────

export function runAbstractionCheck(text, scene) {
  const findings = analyzeV0Text(text, scene);
  const abstraction = findings.filter((f) => f.type === "abstraction");
  const compression = findings.filter((f) => f.type === "compression");
  const bodyDrift   = findings.filter((f) => f.type === "body_check");
  const total = splitSentences(text).length || 1;
  const clean = abstraction.length === 0 && bodyDrift.length === 0;

  return {
    type: "abstraction",
    label: "Abstraction Check",
    pass: clean,
    score: Math.max(0, 100 - Math.round(((abstraction.length + bodyDrift.length) / total) * 100)),
    findings: { abstraction, compression, bodyDrift },
    summary: clean
      ? "No abstraction detected."
      : `${abstraction.length} abstraction flag${abstraction.length !== 1 ? "s" : ""}, ${bodyDrift.length} body-drift sentence${bodyDrift.length !== 1 ? "s" : ""}.`,
  };
}

// ── Body check ───────────────────────────────────────────────────

export function runBodyCheck(text) {
  const body = analyzeBodyGrounding(text);

  if (!body.totalSentences) {
    return {
      type: "body",
      label: "Body Check",
      ...body,
      summary: "No text.",
    };
  }

  return {
    type: "body",
    label: "Body Check",
    ...body,
    summary: `${body.bodySentences}/${body.totalSentences} sentences contain body language (${body.score}%). ${body.pass ? "Good." : "Needs more physical grounding."}`,
  };
}

// ── Dev editor warnings ──────────────────────────────────────────

export function runDevEditWarnings(text) {
  const wordCount = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  const lower = text.toLowerCase();
  const warnings = [];

  for (const warn of devData.devEditWarnings) {
    if (warn.id === "scene_too_short" && wordCount < warn.minWords) {
      warnings.push({ id: warn.id, label: warn.label, wordCount });
    }
    if (warn.id === "no_body_words") {
      const hits = BODY_WORDS.filter((w) => lower.includes(w)).length;
      if (hits <= warn.threshold) warnings.push({ id: warn.id, label: warn.label, hits });
    }
    if (warn.id === "too_many_explanations") {
      const hits = devData.explanationFlags.filter((w) => lower.includes(w)).length;
      if (hits >= warn.threshold) warnings.push({ id: warn.id, label: warn.label, hits });
    }
  }

  return warnings;
}

// ── Full dev editor pass ─────────────────────────────────────────

export function runDevEditor(text, scene) {
  return {
    abstraction: runAbstractionCheck(text, scene),
    body:        runBodyCheck(text),
    completion:  { ...checkSceneDone(text), type: "completion", label: "Scene Completion Check" },
    warnings:    runDevEditWarnings(text),
  };
}
