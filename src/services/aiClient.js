/**
 * src/services/aiClient.js
 * Optional AI integration stub.
 *
 * DISABLED BY DEFAULT.
 * Nothing in the core app imports this file.
 * No API key is required for core functionality.
 * Deterministic local engines run first and are always sufficient for Phase 1–2.
 *
 * Activate by:
 *   1. Setting VITE_AI_ENABLED=true in a .env file
 *   2. Setting VITE_ANTHROPIC_API_KEY=your_key_here
 *   3. Explicitly calling functions in this file from opt-in UI
 *
 * Token discipline rules (CRITICAL):
 *   - Never send the full manuscript.
 *   - Send only the current scene draft unless user explicitly requests cross-scene.
 *   - Summarize source material before including it — never send raw.
 *   - User must explicitly trigger any API call (no background calls).
 *   - Local deterministic engines always run first.
 *   - Never send continuity ledger or full drafts automatically.
 *   - Cap response length via max_tokens on every call.
 *   - Cache reusable results and avoid duplicate requests.
 *
 * Model routing:
 *   - Haiku:  cheap/fast — simple transformations, pattern detection, quick rewrites
 *   - Sonnet: structured analysis, developmental editor tasks, consistency checks
 *   - Opus:   deep narrative analysis, beta reader simulation, multi-scene reasoning (rare)
 */

const AI_ENABLED = import.meta.env?.VITE_AI_ENABLED === "true";
const API_KEY    = import.meta.env?.VITE_ANTHROPIC_API_KEY || null;

// Model constants
export const MODELS = {
  HAIKU:  "claude-haiku-4-5",
  SONNET: "claude-sonnet-4-5",
  OPUS:   "claude-opus-4-5",
};

// Default to cheapest model that can do the job
const DEFAULT_MODEL = MODELS.HAIKU;

/**
 * Check whether AI is available for use.
 * Call this before any AI feature to avoid silent failures.
 */
export function isAIAvailable() {
  return AI_ENABLED && !!API_KEY;
}

/**
 * Internal call wrapper — handles token discipline and error handling.
 * Never called automatically. Only called by explicit user-triggered functions.
 */
async function callAI({ model = DEFAULT_MODEL, systemPrompt, userContent, maxTokens = 512 }) {
  if (!isAIAvailable()) {
    throw new Error("AI is not enabled. Set VITE_AI_ENABLED=true and VITE_ANTHROPIC_API_KEY in your .env file.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`AI API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || "";
}

// ── Optional AI features (all require user opt-in) ──────────────

/**
 * Quick rewrite suggestion for a single flagged sentence.
 * Uses Haiku — cheap, fast. Sends ONLY the flagged sentence and the rule.
 * Token discipline: ~100 tokens in, ~100 tokens out.
 */
export async function getSentenceRewrite(sentence, rule, sceneContext = "") {
  const context = sceneContext
    ? `Scene rule: "${sceneContext}"\n\n`
    : "";
  return callAI({
    model: MODELS.HAIKU,
    maxTokens: 150,
    systemPrompt: "You are a line editor for body-first literary fiction. Rewrite the flagged sentence to be purely physical — no abstraction, no emotion labeling, no explanation. Return only the rewritten sentence.",
    userContent: `${context}Flagged sentence: "${sentence}"\nReason: ${rule}\n\nRewrite this sentence physically.`,
  });
}

/**
 * Developmental editor note for a single scene draft.
 * Uses Sonnet. Sends ONLY the current scene draft, not the manuscript.
 * Token discipline: scene draft only, capped at 1000 tokens out.
 */
export async function getDevEditorNote(sceneDraft, sceneRule = "") {
  if (!sceneDraft || sceneDraft.trim().length < 50) {
    throw new Error("Draft is too short for developmental analysis.");
  }
  return callAI({
    model: MODELS.SONNET,
    maxTokens: 1000,
    systemPrompt: "You are a developmental editor for body-first literary fiction. Analyze the provided scene draft for: (1) abstraction/explanation creeping in, (2) body language density, (3) rhythm and pacing, (4) whether the scene rule is honored. Be specific and surgical. Return structured notes, not encouragement.",
    userContent: `Scene rule: "${sceneRule || "Body first, no explanation."}"\n\nDraft:\n${sceneDraft}`,
  });
}

/**
 * Beta reader simulation — how does this scene land emotionally?
 * Uses Sonnet. Current scene only.
 */
export async function getBetaReaderNote(sceneDraft) {
  if (!sceneDraft || sceneDraft.trim().length < 100) {
    throw new Error("Draft is too short for beta reader simulation.");
  }
  return callAI({
    model: MODELS.SONNET,
    maxTokens: 800,
    systemPrompt: "Simulate a careful literary reader responding to this scene draft. Note: what lands, what confuses, what feels earned, what feels like it's working too hard. No coaching — pure reader response.",
    userContent: sceneDraft,
  });
}

/**
 * Deep multi-scene narrative analysis.
 * Uses Opus. ONLY call when user explicitly requests cross-scene analysis.
 * Never called automatically.
 * Token discipline: summarize scenes before sending — never send raw drafts of all scenes.
 */
export async function getDeepNarrativeAnalysis(sceneSummaries) {
  if (!Array.isArray(sceneSummaries) || !sceneSummaries.length) {
    throw new Error("Scene summaries required for deep analysis.");
  }
  const content = sceneSummaries
    .map((s) => `Scene ${s.number}: ${s.title}\nSummary: ${s.summary}`)
    .join("\n\n");

  return callAI({
    model: MODELS.OPUS,
    maxTokens: 2000,
    systemPrompt: "You are a structural editor analyzing a literary manuscript. Using scene summaries only, identify: arc shape, pattern repetition, escalation logic, missing beats, and structural risks. Be precise. No encouragement.",
    userContent: content,
  });
}
