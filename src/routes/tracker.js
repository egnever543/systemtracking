import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { supabase } from '../db/index.js';
import { mapSite, mapSiteNumber } from '../db/mappers.js';
import { randomUUID, createHash } from 'crypto';
import { generateTrackingId } from '../services/idGenerator.js';
import { sendLeadEvent } from '../services/facebookCapi.js';
import { fireWebhook } from '../services/webhook.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewsDir = join(__dirname, '../../views');

const tracker = new Hono();

tracker.use('/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }));

const TRACKING_RE = /^WA-[A-Z2-9]{6}$/;

function selectByWeight(numbers) {
  const total = numbers.reduce((sum, n) => sum + n.weight, 0);
  let rand = Math.random() * total;
  for (const n of numbers) {
    rand -= n.weight;
    if (rand <= 0) return n;
  }
  return numbers[numbers.length - 1];
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hexToRgba(hex, alpha) {
  try {
    const h = (hex || '#25D366').replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  } catch {
    return `rgba(37,211,102,${alpha})`;
  }
}

function youtubeEmbedUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return `https://www.youtube.com/embed${u.pathname}`;
    if (u.pathname === '/watch') {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/embed/${v}`;
    }
    if (u.pathname.startsWith('/embed/')) return url;
  } catch {}
  return null;
}

const FIELD_INPUT_TYPES = { name: 'text', email: 'email', phone: 'tel', text: 'text' };
const FIELD_AUTO = { name: 'name', email: 'email', phone: 'tel', text: 'off' };

function renderFormFields(fields) {
  return (fields || []).map((f, i) => {
    const type = FIELD_INPUT_TYPES[f.type] || 'text';
    const auto = FIELD_AUTO[f.type] || 'off';
    const label = escapeHtml(f.label || f.type);
    const req = f.required ? ' required' : '';
    const reqMark = f.required ? '<span class="req">*</span>' : '';
    return `<div class="field-wrap"><label class="field-label">${label} ${reqMark}</label><input type="${type}" name="field_${i}" data-label="${label}" autocomplete="${auto}"${req} class="field-input" placeholder="${label}" /></div>`;
  }).join('');
}

tracker.get('/r/:siteId', async (c) => {
  const { siteId } = c.req.param();

  const [{ data: raw }, { data: numbersRaw }] = await Promise.all([
    supabase.from('sites').select('*').eq('id', siteId).maybeSingle(),
    supabase.from('site_numbers').select('*').eq('site_id', siteId).order('created_at'),
  ]);

  const site = mapSite(raw);
  if (!site) return c.redirect('https://wa.me/');

  const numbers = (numbersRaw || []).map(mapSiteNumber).filter(Boolean);
  const selected = numbers.length > 0
    ? selectByWeight(numbers)
    : { number: site.whatsappNumber, label: null };

  const query = c.req.query();
  const clickParams = Object.fromEntries(Object.entries(query).filter(([, v]) => v));

  const ipOriginal =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    c.req.header('cf-connecting-ip') ||
    'desconhecido';
  const ipHash = createHash('sha256').update(ipOriginal).digest('hex').slice(0, 16);

  const trackingId = generateTrackingId();

  await supabase.from('events').insert({
    id: randomUUID(),
    site_id: site.id,
    tracking_id: trackingId,
    fbclid: query.fbclid || null,
    user_agent: c.req.header('user-agent') || null,
    ip_hash: ipHash,
    ip_original: ipOriginal,
    page_url: c.req.header('referer') || null,
    click_params: Object.keys(clickParams).length > 0 ? clickParams : null,
    selected_number: selected.number,
  });

  // Dispara Lead para Facebook CAPI em background se o site tiver Pixel configurado
  if (site.fbPixelId && site.fbAccessToken) {
    sendLeadEvent({
      pixelId: site.fbPixelId,
      accessToken: site.fbAccessToken,
      testEventCode: site.fbTestEventCode || null,
      trackingId,
      pageUrl: c.req.header('referer') || null,
      fbclid: query.fbclid || null,
      eventCreatedAt: new Date().toISOString(),
      ipOriginal,
      userAgent: c.req.header('user-agent') || null,
    }).catch(() => {});
  }

  // Webhook de clique
  if (site.webhookUrl && Array.isArray(site.webhookEvents) && site.webhookEvents.includes('click.created')) {
    fireWebhook(site.webhookUrl, {
      event: 'click.created',
      siteId: site.id,
      siteName: site.name,
      data: {
        trackingId,
        selectedNumber: selected.number,
        fbclid: query.fbclid || null,
        pageUrl: c.req.header('referer') || null,
        clickParams: Object.keys(clickParams).length > 0 ? clickParams : null,
        createdAt: new Date().toISOString(),
      },
    }).catch(() => {});
  }

  const destType = selected.destinationType || 'whatsapp';
  let destUrl;
  if (destType === 'url') {
    try {
      const u = new URL(selected.number);
      for (const [k, v] of Object.entries(clickParams)) {
        if (v && !u.searchParams.has(k)) u.searchParams.set(k, v);
      }
      destUrl = u.toString();
    } catch {
      destUrl = selected.number;
    }
  } else if (destType === 'telegram') {
    const val = selected.number.trim();
    destUrl = val.startsWith('http') ? val : `https://t.me/${val.replace(/^@/, '')}`;
  } else if (destType === 'whatsapp_group') {
    destUrl = selected.number;
  } else {
    const msg = (site.defaultMessage || '') + ' [' + trackingId + ']';
    destUrl = 'https://wa.me/' + selected.number + '?text=' + encodeURIComponent(msg);
  }

  const deliveryMode = site.deliveryMode || 'direct';

  if (deliveryMode === 'direct') {
    return c.redirect(destUrl, 302);
  }

  // Shared setup for presell, form, vsl
  const { data: owner } = await supabase.from('users').select('logo_url').eq('id', site.userId).maybeSingle();
  const logoUrl = site.siteLogoUrl || owner?.logo_url || '';
  const bgColor = site.presellBgColor || '#0f172a';
  const accentColor = site.presellAccentColor || '#25D366';

  const logoHtml = logoUrl
    ? `<div class="logo-wrap"><img src="${logoUrl}" alt="" class="logo-img"></div>`
    : `<div class="logo-wrap"><div class="logo-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg></div></div>`;

  const subtitleHtml = site.presellSubtitle
    ? `<p class="subtitle">${escapeHtml(site.presellSubtitle)}</p>`
    : '';

  switch (deliveryMode) {
    case 'presell': {
      const bullets = Array.isArray(site.presellBullets) ? site.presellBullets.filter(b => b?.trim()) : [];
      const checkSvg = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,7 6,11 12,3"/></svg>`;
      const bulletsHtml = bullets.length > 0
        ? `<ul class="bullets">${bullets.map(b => `<li class="bullet"><span class="bullet-check">${checkSvg}</span><span>${escapeHtml(b)}</span></li>`).join('')}</ul>`
        : '';

      let html = readFileSync(join(viewsDir, 'presell.html'), 'utf-8');
      html = html
        .replaceAll('{{pageTitle}}', escapeHtml(site.presellTitle || site.name))
        .replaceAll('{{bgColor}}', bgColor)
        .replaceAll('{{accentColor}}', accentColor)
        .replaceAll('{{accentRgba18}}', hexToRgba(accentColor, 0.18))
        .replaceAll('{{accentRgba30}}', hexToRgba(accentColor, 0.30))
        .replaceAll('{{accentRgba40}}', hexToRgba(accentColor, 0.40))
        .replaceAll('{{logoHtml}}', logoHtml)
        .replaceAll('{{title}}', escapeHtml(site.presellTitle || site.name))
        .replaceAll('{{subtitleHtml}}', subtitleHtml)
        .replaceAll('{{bulletsHtml}}', bulletsHtml)
        .replaceAll('{{ctaText}}', escapeHtml(site.presellCtaText || 'Falar no WhatsApp'))
        .replaceAll('{{whatsappUrl}}', destUrl);

      return c.html(html);
    }

    case 'form': {
      let html = readFileSync(join(viewsDir, 'form.html'), 'utf-8');
      html = html
        .replaceAll('{{pageTitle}}', escapeHtml(site.presellTitle || site.name))
        .replaceAll('{{bgColor}}', bgColor)
        .replaceAll('{{accentColor}}', accentColor)
        .replaceAll('{{accentRgba18}}', hexToRgba(accentColor, 0.18))
        .replaceAll('{{accentRgba30}}', hexToRgba(accentColor, 0.30))
        .replaceAll('{{accentRgba40}}', hexToRgba(accentColor, 0.40))
        .replaceAll('{{logoHtml}}', logoHtml)
        .replaceAll('{{title}}', escapeHtml(site.presellTitle || site.name))
        .replaceAll('{{subtitleHtml}}', subtitleHtml)
        .replaceAll('{{fieldsHtml}}', renderFormFields(site.formFields))
        .replaceAll('{{ctaText}}', escapeHtml(site.presellCtaText || 'Continuar no WhatsApp'))
        .replaceAll('{{whatsappUrl}}', destUrl)
        .replaceAll('{{trackingId}}', trackingId)
        .replaceAll('{{siteId}}', site.id);

      return c.html(html);
    }

    case 'vsl': {
      const embedUrl = youtubeEmbedUrl(site.vslVideoUrl);
      if (!embedUrl) return c.redirect(destUrl, 302);

      let html = readFileSync(join(viewsDir, 'vsl.html'), 'utf-8');
      html = html
        .replaceAll('{{pageTitle}}', escapeHtml(site.presellTitle || site.name))
        .replaceAll('{{bgColor}}', bgColor)
        .replaceAll('{{accentColor}}', accentColor)
        .replaceAll('{{accentRgba18}}', hexToRgba(accentColor, 0.18))
        .replaceAll('{{accentRgba30}}', hexToRgba(accentColor, 0.30))
        .replaceAll('{{accentRgba40}}', hexToRgba(accentColor, 0.40))
        .replaceAll('{{logoHtml}}', logoHtml)
        .replaceAll('{{title}}', escapeHtml(site.presellTitle || site.name))
        .replaceAll('{{subtitleHtml}}', subtitleHtml)
        .replaceAll('{{videoEmbedUrl}}', embedUrl)
        .replaceAll('{{ctaText}}', escapeHtml(site.presellCtaText || 'Falar no WhatsApp'))
        .replaceAll('{{whatsappUrl}}', destUrl)
        .replaceAll('{{delayMs}}', String((site.vslDelaySeconds || 0) * 1000));

      return c.html(html);
    }

    default:
      return c.redirect(destUrl, 302);
  }
});

tracker.get('/:siteId/config', async (c) => {
  const { siteId } = c.req.param();
  const { data: raw } = await supabase.from('sites').select('*').eq('id', siteId).maybeSingle();
  const site = mapSite(raw);
  if (!site) return c.json({ erro: 'Site não encontrado' }, 404);

  return c.json({ phone: site.whatsappNumber, message: site.defaultMessage });
});

tracker.post('/:siteId', async (c) => {
  const { siteId } = c.req.param();

  const { data: raw } = await supabase.from('sites').select('*').eq('id', siteId).maybeSingle();
  const site = mapSite(raw);
  if (!site) return c.json({ erro: 'Site não encontrado' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const { fbclid, page_url, user_agent, tracking_id: clientTrackingId } = body;

  const ipOriginal =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    c.req.header('cf-connecting-ip') ||
    'desconhecido';

  const ipHash = createHash('sha256').update(ipOriginal).digest('hex').slice(0, 16);

  let trackingId;
  if (clientTrackingId && TRACKING_RE.test(clientTrackingId)) {
    trackingId = clientTrackingId;
  } else {
    let tentativas = 0;
    do {
      trackingId = generateTrackingId();
      const { data: existe } = await supabase.from('events').select('id').eq('tracking_id', trackingId).maybeSingle();
      if (!existe) break;
      tentativas++;
    } while (tentativas < 5);
  }

  await supabase.from('events').insert({
    id: randomUUID(),
    site_id: site.id,
    tracking_id: trackingId,
    fbclid: fbclid || null,
    user_agent: user_agent || c.req.header('user-agent') || null,
    ip_hash: ipHash,
    ip_original: ipOriginal,
    page_url: page_url || null,
  });

  return c.json({
    tracking_id: trackingId,
    phone: site.whatsappNumber,
    message: site.defaultMessage,
  });
});

tracker.post('/:siteId/form', async (c) => {
  const { siteId } = c.req.param();
  const body = await c.req.json().catch(() => ({}));
  const { trackingId, fields } = body;
  if (trackingId && fields && typeof fields === 'object') {
    supabase.from('events')
      .select('click_params')
      .eq('tracking_id', trackingId)
      .eq('site_id', siteId)
      .maybeSingle()
      .then(({ data }) => {
        const merged = { ...(data?.click_params || {}), _form: fields };
        return supabase.from('events')
          .update({ click_params: merged })
          .eq('tracking_id', trackingId)
          .eq('site_id', siteId);
      })
      .catch(() => {});
  }
  return c.json({ ok: true });
});

export default tracker;
