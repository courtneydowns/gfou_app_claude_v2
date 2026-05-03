// toast.js
export function createToast(message, type = "info") {
  window.dispatchEvent(new CustomEvent("gfou:toast", {
    detail: { message, type, id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}` }
  }));
}
