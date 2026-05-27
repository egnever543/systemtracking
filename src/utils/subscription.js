import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export function getSubscriptionBanner(userId) {
  const user = db.select({
    subscriptionStatus: users.subscriptionStatus,
    trialEndsAt: users.trialEndsAt,
  }).from(users).where(eq(users.id, userId)).get();

  if (!user || user.subscriptionStatus === 'active') return '';

  const now = new Date();

  if (!user.subscriptionStatus || user.subscriptionStatus === 'trialing') {
    const trialEnd = user.trialEndsAt ? new Date(user.trialEndsAt) : null;
    if (!trialEnd) return '';

    const daysLeft = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));

    if (daysLeft > 0) {
      return `<div class="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-sm text-amber-800">
        Seu trial termina em <strong>${daysLeft} dia${daysLeft !== 1 ? 's' : ''}</strong>.
        <a href="/billing" class="font-semibold underline ml-1">Assine agora</a> para continuar sem interrupções.
      </div>`;
    }

    return `<div class="bg-red-50 border-b border-red-200 px-4 py-2 text-center text-sm text-red-800">
      Seu período de teste expirou.
      <a href="/billing" class="font-semibold underline ml-1">Assine agora</a> para continuar usando.
    </div>`;
  }

  if (user.subscriptionStatus === 'expired') {
    return `<div class="bg-red-50 border-b border-red-200 px-4 py-2 text-center text-sm text-red-800">
      Sua assinatura expirou.
      <a href="/billing" class="font-semibold underline ml-1">Renove agora</a> para continuar usando.
    </div>`;
  }

  return '';
}
