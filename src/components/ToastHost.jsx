import React, { useCallback, useEffect, useState } from "react";

export default function ToastHost() {
  const [toasts, setToasts] = useState([]);

  const add = useCallback((e) => {
    const t = e.detail;
    setToasts((prev) => [...prev.slice(-5), t]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 3400);
  }, []);

  useEffect(() => {
    window.addEventListener("gfou:toast", add);
    return () => window.removeEventListener("gfou:toast", add);
  }, [add]);

  if (!toasts.length) return null;
  return (
    <div style={{ position:"fixed", bottom:20, right:20, zIndex:99999, display:"flex", flexDirection:"column", gap:6, pointerEvents:"none" }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          padding:"9px 16px", borderRadius:"var(--r-md)", fontSize:13,
          fontFamily:"var(--font-sans)", background:"var(--bg-surface)",
          border:`1px solid ${t.type==="success"?"#2d5a3a":t.type==="error"?"#5a2a2a":"var(--border-mid)"}`,
          color: t.type==="success"?"#80c896":t.type==="error"?"#e08080":"var(--text-2)",
          animation:"toast-in .18s ease", maxWidth:340
        }}>{t.message}</div>
      ))}
      <style>{`@keyframes toast-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}
