// Generates the Apple "client secret" JWT that Supabase's Apple provider needs
// in its "Secret Key (for OAuth)" field. Reads the .p8 locally; nothing is sent anywhere.
//
// Usage:
//   node scripts/generate-apple-secret.js <path-to-.p8> <teamId> [servicesId] [keyId]
//
// keyId is auto-detected from a filename like AuthKey_XXXXXXXXXX.p8 if omitted.
// Apple caps the token lifetime at 6 months, so this must be re-run periodically.

const crypto = require('crypto');
const fs = require('fs');

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

const [, , p8Path, teamId, servicesId = 'com.swiftlap.web.signin', keyIdArg] = process.argv;

if (!p8Path || !teamId) {
  console.error('Usage: node scripts/generate-apple-secret.js <path-to-.p8> <teamId> [servicesId] [keyId]');
  process.exit(1);
}

let keyId = keyIdArg;
if (!keyId) {
  const m = /AuthKey_([A-Za-z0-9]+)\.p8/.exec(p8Path);
  keyId = m && m[1];
}
if (!keyId) {
  console.error('Could not detect Key ID from filename — pass it as the 4th argument.');
  process.exit(1);
}

const privateKey = fs.readFileSync(p8Path, 'utf8');
const now = Math.floor(Date.now() / 1000);
const exp = now + 60 * 60 * 24 * 180; // 180 days (Apple max is ~6 months)

const header = { alg: 'ES256', kid: keyId };
const payload = {
  iss: teamId,
  iat: now,
  exp,
  aud: 'https://appleid.apple.com',
  sub: servicesId,
};

const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
const signature = crypto.createSign('SHA256')
  .update(signingInput)
  .sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });

const jwt = `${signingInput}.${b64url(signature)}`;

console.log('\nPaste this into Supabase → Authentication → Providers → Apple → "Secret Key (for OAuth)":\n');
console.log(jwt);
console.log(`\n(Expires ${new Date(exp * 1000).toDateString()} — regenerate before then.)\n`);
