/**
 * Integração com Facebook Conversions API (CAPI)
 * Documentação: https://developers.facebook.com/docs/marketing-api/conversions-api
 */

const CAPI_VERSION = 'v19.0';
const CAPI_BASE = 'https://graph.facebook.com';

/**
 * Formata o fbclid no padrão fbc exigido pela Meta
 * @param {string} fbclid
 * @param {string} createdAt - ISO string da criação do evento
 * @returns {string}
 */
function formatFbc(fbclid, createdAt) {
  const timestamp = Math.floor(new Date(createdAt).getTime() / 1000);
  return `fb.1.${timestamp}.${fbclid}`;
}

/**
 * Envia uma conversão de Purchase para o Facebook CAPI
 * @param {Object} params
 * @param {string} params.pixelId
 * @param {string} params.accessToken
 * @param {string|null} params.testEventCode
 * @param {string} params.trackingId - usado como event_id para deduplicação
 * @param {string} params.pageUrl
 * @param {string|null} params.fbclid
 * @param {string} params.eventCreatedAt - ISO string do momento do clique
 * @param {string|null} params.ipOriginal
 * @param {string|null} params.userAgent
 * @param {number} params.value
 * @param {string} params.currency
 * @returns {Promise<{success: boolean, response: object, error?: string}>}
 */
export async function sendLeadEvent(params) {
  const {
    pixelId,
    accessToken,
    testEventCode,
    trackingId,
    pageUrl,
    fbclid,
    eventCreatedAt,
    ipOriginal,
    userAgent,
  } = params;

  const userData = {};
  if (ipOriginal) userData.client_ip_address = ipOriginal;
  if (userAgent) userData.client_user_agent = userAgent;
  if (fbclid) userData.fbc = formatFbc(fbclid, eventCreatedAt);

  const payload = {
    data: [
      {
        event_name: 'Lead',
        event_time: Math.floor(Date.now() / 1000),
        event_id: `lead_${trackingId}`,
        action_source: 'website',
        event_source_url: pageUrl || undefined,
        user_data: userData,
      },
    ],
  };

  if (testEventCode) payload.test_event_code = testEventCode;

  const url = `${CAPI_BASE}/${CAPI_VERSION}/${pixelId}/events?access_token=${accessToken}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { success: res.ok, response: await res.json() };
  } catch (err) {
    return { success: false, response: {}, error: err.message };
  }
}

export async function sendPurchaseEvent(params) {
  const {
    pixelId,
    accessToken,
    testEventCode,
    trackingId,
    pageUrl,
    fbclid,
    eventCreatedAt,
    ipOriginal,
    userAgent,
    value,
    currency,
  } = params;

  const userData = {};
  if (ipOriginal) userData.client_ip_address = ipOriginal;
  if (userAgent) userData.client_user_agent = userAgent;
  if (fbclid) userData.fbc = formatFbc(fbclid, eventCreatedAt);

  const payload = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: trackingId,
        action_source: 'website',
        event_source_url: pageUrl || undefined,
        user_data: userData,
        custom_data: {
          value: parseFloat(value),
          currency: currency || 'BRL',
        },
      },
    ],
  };

  if (testEventCode) {
    payload.test_event_code = testEventCode;
  }

  const url = `${CAPI_BASE}/${CAPI_VERSION}/${pixelId}/events?access_token=${accessToken}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      const msg = data?.error?.message || `Erro HTTP ${res.status}`;
      return { success: false, response: data, error: msg };
    }

    return { success: true, response: data };
  } catch (err) {
    return {
      success: false,
      response: {},
      error: `Falha de conexão com a API do Facebook: ${err.message}`,
    };
  }
}
