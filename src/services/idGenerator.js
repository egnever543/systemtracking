// Gera IDs no formato WA-XXXXXX (6 caracteres alfanuméricos maiúsculos)
// Fácil de comunicar verbalmente e digitar no painel
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // remove chars ambíguos: O,0,1,I

/**
 * @returns {string} Ex: "WA-8F3K2P"
 */
export function generateTrackingId() {
  let result = 'WA-';
  for (let i = 0; i < 6; i++) {
    result += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return result;
}
