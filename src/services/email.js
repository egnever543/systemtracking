import { Resend } from 'resend';

let _client = null;

function getClient() {
  if (!_client && process.env.RESEND_API_KEY) {
    _client = new Resend(process.env.RESEND_API_KEY);
  }
  return _client;
}

export async function sendEmail({ to, subject, html }) {
  const client = getClient();
  if (!client) return;
  try {
    await client.emails.send({
      from: process.env.EMAIL_FROM || 'MeuFluxo <noreply@wacapi.com.br>',
      to,
      subject,
      html,
    });
  } catch (err) {
    console.error('[email] Erro ao enviar para', to, ':', err.message);
  }
}

export function conversionEmailHtml({ siteName, trackingId, value, currency }) {
  const base = process.env.PUBLIC_BASE_URL || '';
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f9fafb;padding:24px;margin:0;">
<div style="max-width:480px;margin:0 auto;background:white;border-radius:12px;padding:24px;border:1px solid #e5e7eb;">
  <div style="background:#18181b;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
    <span style="color:white;font-weight:700;font-size:16px;">&#128176; Nova venda registrada!</span>
  </div>
  <p style="color:#374151;margin:0 0 16px;font-size:14px;">Uma conversão foi registrada no site <strong>${siteName}</strong>.</p>
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px;border-radius:8px;overflow:hidden;">
    <tr>
      <td style="padding:10px 14px;background:#f9fafb;font-size:12px;color:#6b7280;width:90px;font-weight:600;">ID</td>
      <td style="padding:10px 14px;background:#f9fafb;font-size:14px;font-weight:700;font-family:monospace;">${trackingId}</td>
    </tr>
    <tr>
      <td style="padding:10px 14px;font-size:12px;color:#6b7280;font-weight:600;">Valor</td>
      <td style="padding:10px 14px;font-size:16px;font-weight:700;color:#18181b;">${currency} ${Number(value).toFixed(2)}</td>
    </tr>
  </table>
  <a href="${base}/dashboard" style="display:inline-block;background:#18181b;color:white;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">Ver Dashboard &rarr;</a>
</div></body></html>`;
}

export function weeklyReportEmailHtml({ userName, period, stats, sites }) {
  const base = process.env.PUBLIC_BASE_URL || '';
  const siteRows = sites.length > 1 ? sites.map(s => `
    <tr>
      <td style="padding:8px 14px;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;">${s.name}</td>
      <td style="padding:8px 14px;font-size:13px;text-align:center;border-bottom:1px solid #f3f4f6;">${s.cliques}</td>
      <td style="padding:8px 14px;font-size:13px;text-align:center;border-bottom:1px solid #f3f4f6;">${s.conversoes}</td>
      <td style="padding:8px 14px;font-size:13px;text-align:center;font-weight:700;color:#18181b;border-bottom:1px solid #f3f4f6;">${s.taxa}%</td>
    </tr>`).join('') : '';

  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f9fafb;padding:24px;margin:0;">
<div style="max-width:540px;margin:0 auto;background:white;border-radius:12px;padding:24px;border:1px solid #e5e7eb;">
  <h2 style="color:#111827;margin:0 0 4px;font-size:20px;">&#128202; Resumo semanal</h2>
  <p style="color:#6b7280;font-size:13px;margin:0 0 24px;">Ol&aacute;, ${userName}! Aqui est&aacute; o resumo de ${period}.</p>
  <table style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:20px;">
    <tr>
      <td style="background:#f0fdf4;border-radius:10px;padding:16px;text-align:center;width:33%;">
        <div style="font-size:28px;font-weight:700;color:#18181b;">${stats.cliques}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px;">Cliques</div>
      </td>
      <td style="background:#eff6ff;border-radius:10px;padding:16px;text-align:center;width:33%;">
        <div style="font-size:28px;font-weight:700;color:#3b82f6;">${stats.conversoes}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px;">Convers&otilde;es</div>
      </td>
      <td style="background:#fefce8;border-radius:10px;padding:16px;text-align:center;width:33%;">
        <div style="font-size:28px;font-weight:700;color:#d97706;">${stats.taxa}%</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px;">Taxa</div>
      </td>
    </tr>
  </table>
  ${sites.length > 1 ? `
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
    <thead><tr style="background:#f9fafb;">
      <th style="padding:8px 14px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;">Site</th>
      <th style="padding:8px 14px;text-align:center;font-size:12px;color:#6b7280;font-weight:600;">Cliques</th>
      <th style="padding:8px 14px;text-align:center;font-size:12px;color:#6b7280;font-weight:600;">Convers&otilde;es</th>
      <th style="padding:8px 14px;text-align:center;font-size:12px;color:#6b7280;font-weight:600;">Taxa</th>
    </tr></thead>
    <tbody>${siteRows}</tbody>
  </table>` : ''}
  <a href="${base}/dashboard" style="display:inline-block;background:#18181b;color:white;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">Ver Dashboard &rarr;</a>
  <p style="color:#9ca3af;font-size:11px;margin-top:20px;">Para n&atilde;o receber estes e-mails, acesse Configura&ccedil;&otilde;es no dashboard.</p>
</div></body></html>`;
}
