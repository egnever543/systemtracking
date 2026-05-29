const TIKTOK_EVENTS_URL = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

export async function sendTiktokConversion({
  pixelId,
  accessToken,
  trackingId,
  pageUrl,
  value,
  currency,
}) {
  if (!pixelId || !accessToken) {
    return { success: false, skipped: true, response: {} };
  }

  const payload = {
    pixel_code: pixelId,
    event: 'Purchase',
    event_id: trackingId,
    timestamp: String(Math.floor(Date.now() / 1000)),
    context: { page: { url: pageUrl || '' } },
    properties: {
      value: parseFloat(value),
      currency: currency || 'BRL',
      content_type: 'product',
    },
  };

  try {
    const res = await fetch(TIKTOK_EVENTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': accessToken,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || data.code !== 0) {
      return { success: false, error: data.message || `HTTP ${res.status}`, response: data };
    }
    return { success: true, response: data };
  } catch (err) {
    return { success: false, error: err.message, response: {} };
  }
}
