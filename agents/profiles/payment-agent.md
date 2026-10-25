![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

# PayPilot

Part of Travel Assist AI, a Highway 1 road-trip concierge built for Cal Hacks 13.0.

PayPilot totals the group order and shows an approval card. After approval it sends a Fetch Payment Protocol request with a Stripe test checkout. It checks Stripe before confirming, and Ledger records the split.

Order something first through MenuScout. Otherwise PayPilot asks you to open a menu or add an item.

Test card: 4242 4242 4242 4242, any future date, any CVC. Stripe test mode only.
