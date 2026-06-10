-- Leads Perdidos: Retargeting automático via CAPI
-- Execute no SQL Editor do Supabase (Database → SQL Editor)

ALTER TABLE sites ADD COLUMN IF NOT EXISTS lost_leads_enabled BOOLEAN DEFAULT false;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS lost_leads_window_hours INTEGER DEFAULT 24;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS lost_leads_event_name TEXT DEFAULT 'LeadAbandoned';

ALTER TABLE events ADD COLUMN IF NOT EXISTS lost_processed_at TIMESTAMPTZ;
