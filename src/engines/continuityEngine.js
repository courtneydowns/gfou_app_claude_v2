/**
 * src/engines/continuityEngine.js
 * Cross-scene continuity checking against the ledger.
 * Loads all rules from continuityChecks.json. UI-independent.
 */

import continuityData from "../knowledge/continuityChecks.json";

export const ENTRY_TYPES = continuityData.entryTypes;

export function runContinuityCheck(text = "", ledgerEntries = []) {
  const issues = [];
  const minLen = continuityData.keywordMinLength;
  const properNounRe = new RegExp(continuityData.properNounPattern);

  for (const entry of ledgerEntries) {
    const keywords = entry.content
      .split(/\s+/)
      .filter((w) => w.length > minLen && properNounRe.test(w));

    for (const kw of keywords) {
      const kwRe = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      const matches = [...text.matchAll(kwRe)];
      if (matches.length > continuityData.duplicateThreshold) {
        issues.push({
          keyword: kw,
          count: matches.length,
          ledger: entry.content,
          scene_id: entry.scene_id,
          entry_type: entry.entry_type,
        });
      }
    }
  }

  return {
    type: "continuity",
    label: "Continuity Check",
    pass: issues.length === 0,
    issues,
    summary:
      issues.length === 0
        ? continuityData.flagMessages.noIssues
        : `${issues.length} potential continuity issue${issues.length !== 1 ? "s" : ""} detected.`,
  };
}

// Summarize ledger entries for a specific scene
export function getLedgerSummary(ledgerEntries = [], sceneId = null) {
  const entries = sceneId
    ? ledgerEntries.filter((e) => e.scene_id === sceneId)
    : ledgerEntries;

  const byType = {};
  for (const type of ENTRY_TYPES) {
    byType[type.id] = entries.filter((e) => e.entry_type === type.id);
  }

  return { total: entries.length, byType };
}
