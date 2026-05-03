import React, { useEffect, useState } from "react";
import SceneLibrary from "./scenes/SceneLibrary.jsx";
import V0WritingPanel from "./v0writing/V0WritingPanel.jsx";
import AnalysisMode from "./analysis/AnalysisMode.jsx";
import BackupPanel from "./backup/BackupPanel.jsx";
import SourceMaterialPanel from "./source/SourceMaterialPanel.jsx";
import ToastHost from "./components/ToastHost.jsx";
import { prefs } from "./lib/api.js";

const VIEWS = [
  { key: "library",  label: "Scene Library" },
  { key: "writer",   label: "V0 Writing"    },
  { key: "analysis", label: "Analysis"      },
  { key: "source",   label: "Source Material"},
  { key: "backups",  label: "Backups"       },
];

export default function App() {
  const [view, setView]               = useState(() => prefs.get("activeTab", "library"));
  const [activeSceneId, setActiveSceneId] = useState(null);
  const [darkMode, setDarkMode]       = useState(() => prefs.get("darkMode", true));

  // Apply dark/light class to <html>
  useEffect(() => {
    const html = document.documentElement;
    if (darkMode) { html.classList.remove("light"); }
    else          { html.classList.add("light");    }
    prefs.set("darkMode", darkMode);
  }, [darkMode]);

  function navigate(v) {
    setView(v);
    prefs.set("activeTab", v);
  }

  function openScene(sceneId) {
    if (!sceneId) return;
    setActiveSceneId(sceneId);
    navigate("writer");
  }

  const navStyle = {
    display: "flex", alignItems: "center", gap: 2,
    padding: "10px 20px",
    borderBottom: "1px solid var(--border-dim)",
    background: "var(--bg-card)", flexShrink: 0,
  };

  const tabStyle = (active) => ({
    background:   active ? "var(--accent-dim)" : "transparent",
    borderColor:  active ? "var(--accent)"     : "transparent",
    color:        active ? "var(--accent-hi)"  : "var(--text-3)",
    fontSize: 13, padding: "6px 14px",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <nav style={navStyle}>
        <span style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)", marginRight: 16 }}>
          GFOU
        </span>
        {VIEWS.map(({ key, label }) => (
          <button key={key} style={tabStyle(view === key)} onClick={() => navigate(key)}>
            {label}
          </button>
        ))}
        <div style={{ marginLeft: "auto" }}>
          <button
            style={{ ...tabStyle(false), fontSize: 12 }}
            onClick={() => setDarkMode((d) => !d)}
            title="Toggle dark/light mode"
          >
            {darkMode ? "☀ Light" : "◑ Dark"}
          </button>
        </div>
      </nav>

      <div style={{ flex: 1, overflow: "auto" }}>
        {view === "library"  && <SceneLibrary onOpenScene={openScene} />}
        {view === "writer"   && <V0WritingPanel sceneId={activeSceneId} onBackToLibrary={() => navigate("library")} />}
        {view === "analysis" && <AnalysisMode onOpenScene={openScene} />}
        {view === "source"   && <SourceMaterialPanel activeSceneId={activeSceneId} />}
        {view === "backups"  && <BackupPanel />}
      </div>

      <ToastHost />
    </div>
  );
}
