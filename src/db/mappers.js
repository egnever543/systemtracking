export const mapSiteNumber = (n) => !n ? null : {
  id: n.id,
  siteId: n.site_id,
  number: n.number,
  label: n.label,
  weight: n.weight,
  createdAt: n.created_at,
};

export const mapUser = (u) => !u ? null : {
  id: u.id,
  email: u.email,
  name: u.name,
  passwordHash: u.password_hash,
  createdAt: u.created_at,
  trialEndsAt: u.trial_ends_at,
  subscriptionStatus: u.subscription_status,
  subscriptionExpiresAt: u.subscription_expires_at,
  mpSubscriptionId: u.mp_subscription_id,
};

export const mapSite = (s) => !s ? null : {
  id: s.id,
  userId: s.user_id,
  name: s.name,
  domain: s.domain,
  whatsappNumber: s.whatsapp_number,
  fbPixelId: s.fb_pixel_id,
  fbAccessToken: s.fb_access_token,
  fbTestEventCode: s.fb_test_event_code,
  defaultMessage: s.default_message,
  googleCustomerId: s.google_customer_id,
  googleConversionActionId: s.google_conversion_action_id,
  googleDeveloperToken: s.google_developer_token,
  googleRefreshToken: s.google_refresh_token,
  tiktokPixelId: s.tiktok_pixel_id,
  tiktokAccessToken: s.tiktok_access_token,
  createdAt: s.created_at,
};

export const mapEvent = (e) => !e ? null : {
  id: e.id,
  siteId: e.site_id,
  trackingId: e.tracking_id,
  fbclid: e.fbclid,
  userAgent: e.user_agent,
  ipHash: e.ip_hash,
  ipOriginal: e.ip_original,
  pageUrl: e.page_url,
  clickParams: e.click_params ?? null,
  createdAt: e.created_at,
};
