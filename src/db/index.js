import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

let _client = null;

function getClient() {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { realtime: { transport: ws } }
    );
  }
  return _client;
}

export const supabase = new Proxy({}, {
  get(_, prop) {
    return getClient()[prop];
  }
});
