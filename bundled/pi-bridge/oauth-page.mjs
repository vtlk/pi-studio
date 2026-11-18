import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

let presentation;

/** Only the disposable Studio login child installs this presentation adapter, before loading Pi.
 * Pi 1.5.2 has no model-login page option. Redirect its exact HTML-only module in memory;
 * leave native callback validation, PKCE, token exchange/storage and installed files untouched.
 */
export function installOAuthPage(labels) {
  let icon;
  try {
    icon = readFileSync(new URL('../../out/renderer/branding/pi-studio-icon.png', import.meta.url));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Source checkout before the first renderer build.
    icon = readFileSync(new URL('../../public/branding/pi-studio-icon.png', import.meta.url));
  }
  presentation = { labels, icon: `data:image/png;base64,${icon.toString('base64')}` };
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (resolved.url.endsWith('/@earendil-works/pi-ai/dist/utils/oauth-page.js')) {
        const metadata = JSON.parse(
          readFileSync(new URL('../../package.json', resolved.url), 'utf8'),
        );
        if (metadata.name !== '@earendil-works/pi-ai' || metadata.version !== '1.5.2')
          throw new Error('Unsupported OAuth page adapter');
        return { ...resolved, url: import.meta.url };
      }
      return resolved;
    },
  });
}

const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

function render(ok, reason) {
  if (!presentation) throw new Error('OAuth page is not configured');
  const { labels, icon } = presentation;
  const heading = ok ? labels.returnTitle : labels.errorTitle;
  // Never render provider error descriptions, codes, tokens or raw exchange responses.
  const detail =
    {
      'State mismatch.': labels.invalidState,
      'Missing authorization code.': labels.missingCode,
      'This sign-in has already been handled.': labels.alreadyHandled,
      'Callback route not found.': labels.notFound,
    }[reason] ?? labels.errorMessage;
  return `<!doctype html>
<html lang="${labels.language === 'ru' ? 'ru' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <title>${escape(heading)} · Pi Studio</title>
  <link rel="icon" href="${icon}">
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: light-dark(#242530, #f0eeea); background: light-dark(#f8f9fb, #171717); }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100svh; display: grid; place-items: center; padding: 32px 20px; }
    main { width: 100%; max-width: 460px; text-align: center; }
    img { display: block; width: 88px; height: 88px; margin: 0 auto 20px; }
    .brand { margin: 0 0 32px; font-size: 18px; font-weight: 600; letter-spacing: -.4px; }
    h1 { margin: 0 0 12px; font-size: 26px; line-height: 1.25; font-weight: 600; letter-spacing: -.5px; }
    p { margin: 0; font-size: 15px; line-height: 1.65; color: light-dark(#636571, #aaa8a4); }
    .note { margin-top: 24px; padding-top: 24px; border-top: 1px solid light-dark(#dedee3, #41413f); font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <img src="${icon}" alt="">
    <div class="brand">Pi Studio</div>
    <h1>${escape(heading)}</h1>
    <p>${escape(ok ? labels.returnMessage : detail)}</p>
    <p class="note">${escape(ok ? labels.closePage : labels.retryMessage)}</p>
  </main>
</body>
</html>`;
}

// Anthropic and MCP can return the code before the token exchange finishes. This page
// confirms only the browser step; Studio still verifies the saved connection separately.
export const oauthSuccessHtml = () => render(true);
export const oauthErrorHtml = (message) => render(false, message);
