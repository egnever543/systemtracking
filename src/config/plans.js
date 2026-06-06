export const PLANS = {
  trial: {
    slug: 'trial',
    name: 'Trial',
    monthlyPrice: 0,
    annualPrice: 0,
    clickLimit: -1,
    siteLimit: -1,
    features: ['CAPI Facebook'],
  },
  starter: {
    slug: 'starter',
    name: 'Starter',
    monthlyPrice: 79,
    annualPrice: 55,
    clickLimit: 10000,
    siteLimit: 3,
    features: ['CAPI Facebook, Google e TikTok', 'Relatórios de UTM e horário', 'Portal do cliente'],
  },
  pro: {
    slug: 'pro',
    name: 'Pro',
    monthlyPrice: 179,
    annualPrice: 119,
    clickLimit: 50000,
    siteLimit: 15,
    features: ['Tudo do Starter', 'Múltiplos pixels por site', 'Webhooks', 'Pixels adicionais do Facebook'],
  },
  agency: {
    slug: 'agency',
    name: 'Agency',
    monthlyPrice: 349,
    annualPrice: 229,
    clickLimit: 200000,
    siteLimit: -1,
    features: ['Tudo do Pro', 'Sites ilimitados', 'Suporte prioritário'],
  },
};

export function getPlan(slug) {
  return PLANS[slug] || PLANS.trial;
}
