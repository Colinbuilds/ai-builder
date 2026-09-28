// App settings. See README.md → "Go-live setup" for where each value comes from.
window.STORE = {
  name: "AI Business Toolkit",
  supportEmail: "",

  // Monthly plan shown on the site. The real price is whatever you set in Stripe.
  price: 29,
  runsPerMonth: 100,

  // Stripe payment link for the monthly subscription.
  subscribeUrl: "",

  // URL of the deployed API server (Cloudflare Worker), e.g. https://ai-toolkit-api.<you>.workers.dev
  apiBase: "",

  // Google OAuth client ID (for "Sign in with Google" and saving to Drive).
  googleClientId: "",
};
