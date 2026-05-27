import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  trialEndsAt: text('trial_ends_at'),
  subscriptionStatus: text('subscription_status').default('trialing'),
  subscriptionExpiresAt: text('subscription_expires_at'),
  mpSubscriptionId: text('mp_subscription_id'),
});

export const sites = sqliteTable('sites', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  domain: text('domain').notNull(),
  whatsappNumber: text('whatsapp_number').notNull(),
  fbPixelId: text('fb_pixel_id'),
  fbAccessToken: text('fb_access_token'),
  fbTestEventCode: text('fb_test_event_code'),
  defaultMessage: text('default_message').default('Olá, vim pelo anúncio e quero saber mais!'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id),
  trackingId: text('tracking_id').notNull().unique(),
  fbclid: text('fbclid'),
  userAgent: text('user_agent'),
  ipHash: text('ip_hash'),
  // IP original para enviar à CAPI (não exposto na UI)
  ipOriginal: text('ip_original'),
  pageUrl: text('page_url'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

export const conversions = sqliteTable('conversions', {
  id: text('id').primaryKey(),
  eventId: text('event_id').notNull().references(() => events.id),
  siteId: text('site_id').notNull().references(() => sites.id),
  value: real('value').notNull(),
  currency: text('currency').notNull().default('BRL'),
  registeredBy: text('registered_by').references(() => users.id),
  registeredAt: text('registered_at').default(sql`(datetime('now'))`),
  fbResponse: text('fb_response'),
  fbSentAt: text('fb_sent_at'),
});
