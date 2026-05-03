import React, { useEffect, useState } from "react";
import { backups as backupsApi, exports_ as exportsApi, appApi } from "../lib/api.js";
import { createToast } from "../components/toast.js";

export default function BackupPanel() {
  const [backupList, setBackupList] = useState([]);
  const [paths, setPaths] = useState(null);
  const [exportHistory, setExportHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(null);

  async function refresh() {
    const [bl, p, eh] = await Promise.all([
      backupsApi.list(),
      backupsApi.getPaths(),
      exportsApi.listExports(),
    ]);
    setBackupList(bl?.backups || []);
    setPaths(p);
    setExportHistory(eh?.exports || []);
  }

  useEffect(() => { refresh(); }, []);

  async function handleManualBackup() {
    setLoading(true);
    try {
      const r = await backupsApi.createManual();
      if (r.ok) { createToast(`Backup created: ${r.filename}`, "success"); await refresh(); }
      else createToast("Backup failed: " + r.error, "error");
    } finally { setLoading(false); }
  }

  async function handleRestore(filename) {
    if (!window.confirm(`Restore from ${filename}?\n\nYour current data will be saved as a pre-restore backup first.`)) return;
    setRestoring(filename);
    try {
      const r = await backupsApi.restore(filename);
      if (r.ok) { createToast(r.message, "success"); await refresh(); }
      else createToast("Restore failed: " + r.error, "error");
    } finally { setRestoring(null); }
  }

  async function handlePanicExport() {
    setLoading(true);
    try {
      const r = await exportsApi.panicExport();
      if (r.ok) {
        createToast(`Panic export complete → ${r.path}`, "success");
        await refresh();
      } else createToast("Export failed: " + r.error, "error");
    } finally { setLoading(false); }
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes/1024).toFixed(1)} KB`;
    return `${(bytes/1048576).toFixed(2)} MB`;
  }

  return (
    <div style={{padding:"28px 32px",maxWidth:900}}>
      <p style={{fontSize:11,letterSpacing:".1em",textTransform:"uppercase",color:"var(--text-3)",marginBottom:5}}>Good for One Use</p>
      <h1 style={{fontSize:28,fontWeight:400,letterSpacing:"-.02em",marginBottom:6}}>Backups &amp; Exports</h1>
      <p style={{color:"var(--text-3)",fontSize:13,marginBottom:22}}>SQLite-backed · automatic daily backup · panic export to JSON + MD + TXT</p>

      {/* Paths */}
      {paths && (
        <div style={{background:"var(--bg-card)",border:"1px solid var(--border-dim)",borderRadius:"var(--r-md)",padding:"12px 16px",marginBottom:20}}>
          <p style={{fontSize:12,fontWeight:500,marginBottom:8,color:"var(--text-2)"}}>Data Locations</p>
          {[["Database",paths.dbPath],["Backups",paths.backupDir],["Data folder",paths.dataDir]].map(([label,p])=>(
            <div key={label} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderTop:"1px solid var(--border-dim)"}}>
              <span style={{fontSize:12,color:"var(--text-3)"}}>{label}</span>
              <code style={{fontSize:11,color:"var(--text-2)",fontFamily:"var(--font-mono)"}}>{p}</code>
            </div>
          ))}
          <button style={{marginTop:10,fontSize:12}} onClick={()=>appApi.openDataFolder()}>Open Data Folder ↗</button>
        </div>
      )}

      {/* Actions */}
      <div style={{display:"flex",gap:10,marginBottom:24,flexWrap:"wrap"}}>
        <button className="btn-accent" onClick={handleManualBackup} disabled={loading}>
          {loading?"Working…":"Create Backup Now"}
        </button>
        <button style={{background:"var(--red-dim)",borderColor:"#5a2a2a",color:"#e08080"}} onClick={handlePanicExport} disabled={loading}>
          ⚠ Panic Export Everything
        </button>
      </div>

      {/* Backup list */}
      <section style={{marginBottom:28}}>
        <h2 style={{fontSize:14,fontWeight:500,marginBottom:12,color:"var(--text-2)"}}>
          SQLite Backups ({backupList.length})
        </h2>
        {backupList.length === 0
          ? <p style={{color:"var(--text-3)",fontSize:13}}>No backups yet. Daily backups run automatically on launch.</p>
          : backupList.map(b=>(
            <div key={b.filename} style={{
              display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,
              background:"var(--bg-card)",border:"1px solid var(--border-dim)",
              borderRadius:"var(--r-md)",padding:"10px 14px",marginBottom:7
            }}>
              <div>
                <p style={{fontSize:13,color:"var(--text-1)",fontFamily:"var(--font-mono)"}}>{b.filename}</p>
                <p style={{fontSize:11,color:"var(--text-3)"}}>{formatSize(b.size)} · {new Date(b.mtime).toLocaleString()}</p>
              </div>
              <button
                className="btn-danger-soft"
                style={{fontSize:12}}
                disabled={restoring===b.filename}
                onClick={()=>handleRestore(b.filename)}
              >{restoring===b.filename?"Restoring…":"Restore"}</button>
            </div>
          ))
        }
      </section>

      {/* Export history */}
      {exportHistory.length > 0 && (
        <section>
          <h2 style={{fontSize:14,fontWeight:500,marginBottom:12,color:"var(--text-2)"}}>
            Export History
          </h2>
          {exportHistory.slice(0,10).map(e=>(
            <div key={e.id} style={{
              display:"flex",alignItems:"center",justifyContent:"space-between",
              background:"var(--bg-card)",border:"1px solid var(--border-dim)",
              borderRadius:"var(--r-md)",padding:"9px 14px",marginBottom:6
            }}>
              <div>
                <p style={{fontSize:13,color:"var(--text-1)"}}>{e.filename}</p>
                <p style={{fontSize:11,color:"var(--text-3)"}}>{e.scene_count} scenes · {new Date(e.created_at).toLocaleString()}</p>
              </div>
              <span style={{fontSize:11,padding:"2px 8px",borderRadius:999,background:"var(--bg-surface)",color:"var(--text-3)",border:"1px solid var(--border-dim)"}}>{e.export_type}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
