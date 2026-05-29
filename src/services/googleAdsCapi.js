const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ADS_API = 'https://googleads.googleapis.com/v16';

async function getAccessToken(refreshToken) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || 'Falha ao renovar token do Google');
  return data.access_token;
}

export async function sendGoogleConversion({
  customerId,
  conversionActionId,
  developerToken,
  refreshToken,
  gclid,
  conversionDateTime,
  value,
  currency,
}) {
  if (!gclid) return { success: false, skipped: true, response: {} };
  if (!customerId || !conversionActionId || !developerToken || !refreshToken) {
    return { success: false, skipped: true, response: {} };
  }

  let accessToken;
  try {
    accessToken = await getAccessToken(refreshToken);
  } catch (err) {
    return { success: false, error: err.message, response: {} };
  }

  const cleanId = String(customerId).replace(/\D/g, '');
  const dt = new Date(conversionDateTime || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}+00:00`;

  const body = {
    conversions: [{
      gclid,
      conversion_action: `customers/${cleanId}/conversionActions/${conversionActionId}`,
      conversion_date_time: dateStr,
      conversion_value: parseFloat(value),
      currency_code: currency || 'BRL',
    }],
    partial_failure: true,
  };

  try {
    const res = await fetch(`${GOOGLE_ADS_API}/customers/${cleanId}:uploadClickConversions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': developerToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error?.message || `HTTP ${res.status}`, response: data };
    if (data.partialFailureError) return { success: false, error: data.partialFailureError.message, response: data };
    return { success: true, response: data };
  } catch (err) {
    return { success: false, error: err.message, response: {} };
  }
}
