export async function fireWebhook(url, payload) {
  if (!url) return { skipped: true };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return { success: res.ok, status: res.status };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}
