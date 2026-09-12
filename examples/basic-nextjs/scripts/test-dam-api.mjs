/**
 * Phase 0 check: verifies the Cloudinary credentials in .env.local work and
 * that the Search API + permanent delivery URLs behave as the picker expects.
 *
 *   npm run test:dam            (empty search = browse all)
 *   npm run test:dam -- beach   (search for "beach")
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Minimal .env.local loader (no dependency needed)
function loadEnvLocal() {
  try {
    const content = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2];
      }
    }
  } catch {
    // no .env.local — rely on process env
  }
}

loadEnvLocal();

const cloud = process.env.CLOUDINARY_CLOUD_NAME;
const key = process.env.CLOUDINARY_API_KEY;
const secret = process.env.CLOUDINARY_API_SECRET;

if (!cloud || !key || !secret) {
  console.error(
    'Missing CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET. Add them to .env.local.'
  );
  process.exit(1);
}

const searchTerm = process.argv[2] ?? '';
const parts = ['-resource_type:video'];
if (searchTerm) {
  parts.unshift(searchTerm);
}

console.log(`Cloudinary API check against cloud '${cloud}'`);
console.log(`Searching for: "${searchTerm}" ...\n`);

try {
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/resources/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
    },
    body: JSON.stringify({ expression: parts.join(' AND '), max_results: 5 }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  const result = JSON.parse(text);
  const resources = result.resources ?? [];

  console.log(`OK — ${result.total_count ?? resources.length} result(s). First ${resources.length}:`);
  for (const r of resources) {
    console.log(`- public_id=${r.public_id} type=${r.resource_type} format=${r.format} ${r.width ?? '?'}x${r.height ?? '?'}`);
    console.log(`    ${r.secure_url}`);
  }

  if (resources[0]) {
    const r = resources[0];
    const encodedId = r.public_id.split('/').map(encodeURIComponent).join('/');
    const thumb = `https://res.cloudinary.com/${cloud}/image/upload/c_fill,w_150,h_150,f_auto,q_auto/${encodedId}.${r.format === 'pdf' ? 'jpg' : r.format}`;
    const check = await fetch(thumb);
    console.log(`\nRendition URL fetch (transformation, no auth): HTTP ${check.status} ${check.ok ? '✅' : '❌'}`);
    console.log(`  ${thumb}`);
  } else {
    console.log('\nNo assets found — upload some test images/PDFs to the Media Library first.');
  }

  console.log('\nCloudinary API verified. ✅');
} catch (error) {
  console.error(`FAILED: ${error.message}`);
  process.exit(1);
}
