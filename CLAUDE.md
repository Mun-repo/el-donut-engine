# El Donut Engine — rules for Claude

- NEVER read, open, search or modify `extension/content.js` or `extension/guard.js` (page guard: which chess.com pages the extension runs on). The owner handles both alone. If a feature needs them, say so and ask the owner to paste only the relevant snippet.
- Claude's scope: UI/UX only — `extension/panel.html`, `extension/panel.css`, `extension/panel.js` (display code only), `extension/i18n.js`, `extension/content.css`.
- Do not change the extension's security (manifest permissions, message origins, bots-only guard).
- Push updates directly to `main`.
- UI style ("Salon"): warm ink surfaces, hairline borders, subtle grain, ONE pink accent, typography-led (small-caps labels). Fraunces serif (bundled, OFL) for title, numerals and descriptions; system font for chess moves (Fraunces "1" reads like "l"). No gradient blobs, no coloured icon tiles, no neon. Light theme available.
- Keep sessions token-efficient: short, focused, minimal exploration.
