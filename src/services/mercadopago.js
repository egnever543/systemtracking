const MP_BASE = 'https://api.mercadopago.com';

export async function createSubscription({ email, userId }) {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  const price = parseFloat(process.env.PLAN_PRICE || '97');
  const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

  const payload = {
    reason: process.env.PLAN_NAME || 'MeuFluxo - Plano Mensal',
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: price,
      currency_id: 'BRL',
    },
    back_url: `${baseUrl}/billing`,
    payer_email: email,
    status: 'pending',
    external_reference: userId,
  };
  console.log('MP payload:', JSON.stringify(payload));
  console.log('MP token (primeiros 20 chars):', accessToken?.slice(0, 20));

  const res = await fetch(`${MP_BASE}/preapproval`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return res.json();
}

export async function getSubscription(subscriptionId) {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  const res = await fetch(`${MP_BASE}/preapproval/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.json();
}
