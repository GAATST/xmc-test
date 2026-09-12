/**
 * Build-time marker for XM Cloud deployment logs. Runs as the first step of
 * `npm run build` and prints:
 *  - a distinctive marker proving THIS source version (with the DAM picker)
 *    is what's being built — old builds print nothing, and
 *  - the non-secret DAM configuration visible to the build.
 * Secrets are never printed, only whether they are set.
 */
const set = (name) => (process.env[name] ? 'set' : 'NOT SET');

console.log('==================================================');
console.log('[DAM-PICKER] build marker: picker source present');
console.log(`[DAM-PICKER] DAM_PICKER_ENABLED      = ${process.env.DAM_PICKER_ENABLED ?? '(not set)'}`);
console.log(`[DAM-PICKER] CLOUDINARY_CLOUD_NAME   = ${process.env.CLOUDINARY_CLOUD_NAME ?? '(not set)'}`);
console.log(`[DAM-PICKER] CLOUDINARY_API_KEY      : ${set('CLOUDINARY_API_KEY')}`);
console.log(`[DAM-PICKER] CLOUDINARY_API_SECRET   : ${set('CLOUDINARY_API_SECRET')}`);
console.log(`[DAM-PICKER] DAM_PICKER_ACCESS_KEY   : ${set('DAM_PICKER_ACCESS_KEY')}`);
console.log('==================================================');
