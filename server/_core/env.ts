export const ENV = {
  appId: process.env.VITE_APP_ID || "maria",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  // Stripe
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  stripeCreatorPriceId: process.env.STRIPE_PRICE_CREATOR ?? "",
  stripeProPriceId: process.env.STRIPE_PRICE_PRO ?? "",
  stripeAgencyPriceId: process.env.STRIPE_PRICE_AGENCY ?? "",
  appBaseUrl: process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000",
};
