// Store settings. This is the only file you need to edit to go live.
//
// Checkout URLs: create one product per tier on Gumroad, Lemon Squeezy, Payhip or
// Stripe Payment Links, upload the matching zip from dist/ as the file to deliver,
// and paste each product's checkout link below.
window.STORE = {
  name: "The AI Solo Business Kit",
  supportEmail: "support@example.com",
  checkout: {
    starter: "",   // $19: dist/ai-solo-business-kit-starter.zip
    complete: "",  // $49: dist/ai-solo-business-kit-complete.zip
    pro: "",       // $97: dist/ai-solo-business-kit-pro.zip
  },
  prices: { starter: 19, complete: 49, pro: 97 },
  // Optional launch discount shown on the page. Set to null to hide it.
  // e.g. "Launch week: use code LAUNCH20 for 20% off". Create the code at checkout first.
  launchBanner: null,
};
