// Relais des sondes de content/probes-main.js vers le cœur (rapport de vie privée).
document.addEventListener('pouley-sonde-7c1e', (event) => {
  const d = String(event.detail || '');
  try { chrome.runtime.sendMessage({ type: 'probe', kind: d.replace(/^[+]/, ''), count: d.startsWith('+') }); } catch {}
});
