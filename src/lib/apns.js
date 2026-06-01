// Apple Push Notification service (APNs) sender — zero external dependencies.
// Uses Node's built-in http2 + crypto: signs a short-lived ES256 JWT with the
// APNs Auth Key (.p8) and POSTs to Apple's HTTP/2 gateway.
//
// Required env (set in Render):
//   APNS_KEY_ID      10-char Key ID of the .p8 auth key
//   APNS_TEAM_ID     Apple Developer Team ID (defaults to 98QNV4FG3G)
//   APNS_P8          contents of the .p8 file (PEM). Newlines may be literal "\n".
//   APNS_BUNDLE_ID   app bundle id / apns-topic (defaults to com.swiftlap.ios)
//   APNS_PRODUCTION  "true" -> api.push.apple.com (TestFlight/App Store builds);
//                    anything else -> api.sandbox.push.apple.com (Xcode dev builds)
const http2 = require('http2');
const crypto = require('crypto');

const KEY_ID = process.env.APNS_KEY_ID;
const TEAM_ID = process.env.APNS_TEAM_ID || '98QNV4FG3G';
const BUNDLE_ID = process.env.APNS_BUNDLE_ID || 'com.swiftlap.ios';
const P8 = (process.env.APNS_P8 || '').replace(/\\n/g, '\n');
const HOST = process.env.APNS_PRODUCTION === 'true'
  ? 'https://api.push.apple.com'
  : 'https://api.sandbox.push.apple.com';

function isConfigured() {
  return Boolean(KEY_ID && TEAM_ID && P8);
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// APNs provider tokens must be reused and refreshed every 20–60 min. Cache one.
let cachedToken = null;
let cachedAt = 0;

function providerToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now - cachedAt < 50 * 60) return cachedToken;
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID }));
  const payload = base64url(JSON.stringify({ iss: TEAM_ID, iat: now }));
  const signingInput = `${header}.${payload}`;
  // APNs wants the raw r||s (JOSE) signature, not DER.
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: P8,
    dsaEncoding: 'ieee-p1363',
  });
  cachedToken = `${signingInput}.${base64url(signature)}`;
  cachedAt = now;
  return cachedToken;
}

// Send one push to a single device token.
// Resolves { token, status } — status 200 = delivered; 410 (or 400
// BadDeviceToken) = the token is dead and the caller should delete it.
function sendOne(client, deviceToken, payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      'authorization': `bearer ${providerToken()}`,
      'apns-topic': BUNDLE_ID,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    });
    let status = 0;
    let data = '';
    req.setEncoding('utf8');
    req.on('response', (headers) => { status = headers[':status']; });
    req.on('data', (chunk) => { data += chunk; });
    req.on('error', () => resolve({ token: deviceToken, status: 0 }));
    req.on('end', () => {
      let reason = '';
      try { reason = JSON.parse(data || '{}').reason || ''; } catch (e) { /* ignore */ }
      resolve({ token: deviceToken, status, reason });
    });
    req.write(body);
    req.end();
  });
}

// Send the same alert to many device tokens. Returns the list of tokens that
// Apple rejected as permanently invalid (caller should delete them). Never
// throws — push is best-effort.
async function sendPush(deviceTokens, { title, body, data } = {}) {
  if (!isConfigured() || !deviceTokens || deviceTokens.length === 0) return [];
  const aps = { alert: { title, body }, sound: 'default' };
  const payload = data ? { aps, ...data } : { aps };

  let client;
  try {
    client = http2.connect(HOST);
  } catch (e) {
    return [];
  }
  client.on('error', () => {});

  const dead = [];
  try {
    const results = await Promise.all(
      deviceTokens.map((t) => sendOne(client, t, payload))
    );
    for (const r of results) {
      if (r.status === 410 || r.reason === 'BadDeviceToken' || r.reason === 'Unregistered') {
        dead.push(r.token);
      }
    }
  } catch (e) {
    // swallow — best effort
  } finally {
    client.close();
  }
  return dead;
}

module.exports = { sendPush, isConfigured };
