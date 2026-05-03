import React, { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const api = window.electronAPI?.backups ?? null;

function fmt(isoStr) {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtBytes(n) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function isManual(filename) { return filename.includes("-manual-"); }
function isSafeguard(filename) { return filename.includes("-pre-restore-"); }
function tagFor(filename) {
  if (isSafeguard(filename)) return { label: "pre-restore", color: "#8b6914", bg: "#2e2208" };
  if (isManual(filename))    return { label: "manual",      color: "#6b9fd4", bg: "#0e1e30" };
  return                            { label: "auto",        color: "#5a9a6a", bg: "#0f2016" };
}

// ---------------------------------------------------------------------------
// Banner component
// ---------------------------------------------------------------------------

function Banner({ type, message, onDismiss }) {
  if (!message) return null;
  const styles = {
    success: { bg: "#0d2518", border: "#1e5c36", color: "#6ece8c" },
    error:   { bg: "#280d0d", border: "#6b1c1c", color: "#f08080" },
    info:    { bg: "#0e1c2e", border: "#1e3d5c", color: "#7ab8f5" },
  };
  const s = styles[type] || styles.info;
  return (
    <div style={{
      background: s.bg, border: `1px solid ${s.border}`, color: s.color,
      borderRadius: 8, padding: "12px 16px",
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      gap: 12, fontSize: 13, lineHeight: 1.5,
    }}>
      <span style={{ whiteSpace: "pre-wrap" }}>{message}</span>
      <button onClick={onDismiss} style={{
        background: "transparent", border: "none", color: s.color,
        cursor: "pointer", fontSize: 16, lineHeight: 1, flexShrink: 0, padding: "0 2px",
      }}>✕</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConfirmModal
// ---------------------------------------------------------------------------

function ConfirmRestoreModal({ backup, onConfirm, onCancel, busy }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.80)",
      zIndex: 9900, display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{
        width: "min(540px,100%)", background: "var(--bg-card)",
        border: "1px solid var(--border-mid)", borderRadius: 12,
        padding: "28px 28px 24px", display: "flex", flexDirection: "column", gap: 18,
      }}>
        <div>
          <p style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 8 }}>
            Confirm Restore
          </p>
          <h2 style={{ fontSize: 20, fontWeight: 400, letterSpacing: "-.01em", marginBottom: 10 }}>
            Restore from backup?
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
            Your current database will be saved as a <strong>pre-restore safeguard backup</strong> first,
            then replaced with:
          </p>
          <div style={{
            marginTop: 12, background: "var(--bg-surface)", border: "1px solid var(--border-dim)",
            borderRadius: 7, padding: "10px 14px",
          }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", wordBreak: "break-all" }}>
              {backup.filename}
            </p>
            <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
              {fmt(backup.mtime)} · {fmtBytes(backup.size)}
            </p>
          </div>
          <p style={{ marginTop: 14, fontSize: 12, color: "var(--text-3)", lineHeight: 1.6 }}>
            The app will reload automatically after a successful restore.
            No backup files will be deleted.
          </p>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onCancel} disabled={busy} style={{ fontSize: 13 }}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              fontSize: 13, background: "#6b1c1c", borderColor: "#a02020",
              color: "#f08080", cursor: busy ? "wait" : "pointer",
            }}
          >
            {busy ? "Restoring…" : "Restore & Reload"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function BackupPanel() {
  const [backups, setBackups]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [paths, setPaths]         = useState(null);
  const [banner, setBanner]       = useState(null); // { type, message }
  const [creating, setCreating]   = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null); // backup object to restore
  const [restoring, setRestoring] = useState(false);

  const notify = useCallback((type, message) => setBanner({ type, message }), []);

  const loadBackups = useCallback(async () => {
    if (!api) { setLoading(false); return; }
    setLoading(true);
    try {
      const [listRes, pathRes] = await Promise.all([api.list(), api.getPaths()]);
      if (listRes.ok) setBackups(listRes.backups);
      else notify("error", "Could not load backup list: " + listRes.error);
      if (pathRes) setPaths(pathRes);
    } catch (err) {
      notify("error", "IPC error: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { loadBackups(); }, [loadBackups]);

  // ── Create manual backup ─────────────────────────────────────────────────

  async function handleCreateBackup() {
    if (!api || creating) return;
    setCreating(true);
    setBanner(null);
    try {
      const res = await api.createManual();
      if (res.ok) {
        notify("success", `Backup created: ${res.filename}`);
        await loadBackups();
      } else {
        notify("error", "Backup failed: " + res.error);
      }
    } catch (err) {
      notify("error", "IPC error: " + err.message);
    } finally {
      setCreating(false);
    }
  }

  // ── Restore ──────────────────────────────────────────────────────────────

  async function handleConfirmRestore() {
    if (!api || !confirmTarget || restoring) return;
    setRestoring(true);
    setBanner(null);
    try {
      const res = await api.restore(confirmTarget.filename);
      if (res.ok) {
        // Show message briefly, then reload the renderer
        setBanner({ type: "success", message: res.message + "\n\nReloading app…" });
        setConfirmTarget(null);
        setTimeout(() => window.location.reload(), 1800);
      } else {
        setRestoring(false);
        setConfirmTarget(null);
        notify("error",
          "Restore failed: " + res.error +
          (res.safeguard ? `\n\nA pre-restore safeguard was saved as:\n${res.safeguard}` : "")
        );
      }
    } catch (err) {
      setRestoring(false);
      setConfirmTarget(null);
      notify("error", "IPC error during restore: " + err.message);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const noApi = !api;

  const dailyBackups    = backups.filter(b => !isManual(b.filename) && !isSafeguard(b.filename));
  const manualBackups   = backups.filter(b => isManual(b.filename));
  const safeguardBackups = backups.filter(b => isSafeguard(b.filename));

  return (
    <div style={{ padding: "28px 32px", maxWidth: 900, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 5 }}>
          Good for One Use
        </p>
        <h1 style={{ fontSize: 30, fontWeight: 400, letterSpacing: "-.02em", marginBottom: 6 }}>
          Backup &amp; Restore
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-3)" }}>
          Manage database backups. Restoring replaces your live database — your current state
          is auto-saved as a safeguard before every restore.
        </p>
      </div>

      {/* Banner */}
      {banner && (
        <div style={{ marginBottom: 20 }}>
          <Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />
        </div>
      )}

      {noApi && (
        <div style={{
          background: "var(--bg-card)", border: "1px solid var(--border-dim)",
          borderRadius: 10, padding: 20, color: "var(--text-3)", fontSize: 13,
        }}>
          Backup API not available. This panel requires the Electron shell.
        </div>
      )}

      {!noApi && (
        <>
          {/* Paths info */}
          {paths && (
            <div style={{
              background: "var(--bg-card)", border: "1px solid var(--border-dim)",
              borderRadius: 10, padding: "14px 18px", marginBottom: 22,
              display: "flex", flexDirection: "column", gap: 6,
            }}>
              <PathRow label="Live database" value={paths.dbPath} />
              <PathRow label="Backup folder" value={paths.backupDir} />
            </div>
          )}

          {/* Create Manual Backup */}
          <div style={{
            background: "var(--bg-card)", border: "1px solid var(--border-dim)",
            borderRadius: 10, padding: "18px 20px", marginBottom: 28,
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
          }}>
            <div>
              <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text-1)", marginBottom: 4 }}>
                Create Backup Now
              </p>
              <p style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5 }}>
                Copies the current <code style={{ fontSize: 11 }}>gfou.sqlite</code> to a timestamped
                file in the backup folder. No data is removed.
              </p>
            </div>
            <button
              className="btn-accent"
              onClick={handleCreateBackup}
              disabled={creating}
              style={{ whiteSpace: "nowrap", minWidth: 160, cursor: creating ? "wait" : "pointer" }}
            >
              {creating ? "Saving…" : "⊕ Create Backup"}
            </button>
          </div>

          {/* Backup list */}
          {loading ? (
            <p style={{ color: "var(--text-3)", fontSize: 13 }}>Loading backup list…</p>
          ) : backups.length === 0 ? (
            <div style={{
              background: "var(--bg-card)", border: "1px solid var(--border-dim)",
              borderRadius: 10, padding: 24, color: "var(--text-3)", fontSize: 13, textAlign: "center",
            }}>
              No backups found in the backup folder.
              Create one above or wait for the daily auto-backup.
            </div>
          ) : (
            <>
              <BackupSection
                title="Auto (daily)"
                count={dailyBackups.length}
                backups={dailyBackups}
                onRestore={setConfirmTarget}
                restoring={restoring}
              />
              <BackupSection
                title="Manual"
                count={manualBackups.length}
                backups={manualBackups}
                onRestore={setConfirmTarget}
                restoring={restoring}
              />
              <BackupSection
                title="Pre-restore safeguards"
                count={safeguardBackups.length}
                backups={safeguardBackups}
                onRestore={setConfirmTarget}
                restoring={restoring}
                dimRestore
              />
            </>
          )}

          {/* Refresh */}
          <div style={{ marginTop: 22, textAlign: "right" }}>
            <button onClick={loadBackups} style={{ fontSize: 12, color: "var(--text-3)" }}>
              ↺ Refresh list
            </button>
          </div>
        </>
      )}

      {/* Confirm modal */}
      {confirmTarget && (
        <ConfirmRestoreModal
          backup={confirmTarget}
          onConfirm={handleConfirmRestore}
          onCancel={() => !restoring && setConfirmTarget(null)}
          busy={restoring}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PathRow({ label, value }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".07em", minWidth: 100, flexShrink: 0 }}>
        {label}
      </span>
      <code style={{ fontSize: 11, color: "var(--text-2)", wordBreak: "break-all" }}>{value}</code>
    </div>
  );
}

function BackupSection({ title, count, backups, onRestore, restoring, dimRestore = false }) {
  const [open, setOpen] = useState(true);
  if (count === 0) return null;

  return (
    <div style={{ marginBottom: 18 }}>
      {/* Section header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", background: "transparent", border: "none",
          borderBottom: "1px solid var(--border-dim)", padding: "8px 0",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          cursor: "pointer", marginBottom: open ? 10 : 0,
        }}
      >
        <span style={{ fontSize: 11, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600 }}>
          {title}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>
          {count} file{count !== 1 ? "s" : ""} {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {backups.map(b => (
            <BackupRow
              key={b.filename}
              backup={b}
              onRestore={onRestore}
              restoring={restoring}
              dimRestore={dimRestore}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BackupRow({ backup, onRestore, restoring, dimRestore }) {
  const tag = tagFor(backup.filename);

  return (
    <div style={{
      background: "var(--bg-card)", border: "1px solid var(--border-dim)",
      borderRadius: 9, padding: "13px 16px",
      display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
    }}>
      {/* Tag */}
      <span style={{
        fontSize: 10, fontWeight: 600, letterSpacing: ".07em", textTransform: "uppercase",
        background: tag.bg, color: tag.color,
        padding: "3px 8px", borderRadius: 999, flexShrink: 0,
        border: `1px solid ${tag.color}30`,
      }}>
        {tag.label}
      </span>

      {/* Filename + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, color: "var(--text-1)", wordBreak: "break-all", marginBottom: 2 }}>
          {backup.filename}
        </p>
        <p style={{ fontSize: 11, color: "var(--text-3)" }}>
          {fmt(backup.mtime)} · {fmtBytes(backup.size)}
        </p>
      </div>

      {/* Restore button */}
      <button
        onClick={() => !restoring && onRestore(backup)}
        disabled={restoring}
        style={{
          fontSize: 12,
          opacity: dimRestore ? 0.6 : 1,
          cursor: restoring ? "wait" : "pointer",
          flexShrink: 0,
          borderColor: dimRestore ? "var(--border-mid)" : undefined,
        }}
        title={dimRestore ? "This is itself a safeguard — you can still restore from it" : "Restore from this backup"}
      >
        Restore
      </button>
    </div>
  );
}
