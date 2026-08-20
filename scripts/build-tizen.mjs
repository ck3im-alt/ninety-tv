// Builds the Vite app and assembles an (unsigned) Tizen .wgt package.
//
// A .wgt is just a zip of the web app root + config.xml. This script does not
// sign the package — signing requires an author certificate created with
// Tizen Studio's Certificate Manager (see TIZEN-PLAN.md, Fase E) and is done
// separately with `tizen package` / `tizen install` once that tooling exists
// on this machine.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const distDir = resolve(root, 'dist');
const stagingDir = resolve(root, '.tizen-staging');
const outFile = resolve(root, 'dist-tizen', 'ninety-tv.wgt');

console.log('[1/4] vite build');
execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit' });

console.log('[2/4] staging widget contents');
rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });
cpSync(distDir, stagingDir, { recursive: true });
cpSync(resolve(root, 'config.xml'), resolve(stagingDir, 'config.xml'));

console.log('[3/4] zipping .wgt');
mkdirSync(resolve(root, 'dist-tizen'), { recursive: true });
rmSync(outFile, { force: true });
execFileSync('zip', ['-r', outFile, '.'], { cwd: stagingDir, stdio: 'inherit' });

console.log(`\nUnsigned widget written to ${outFile}`);
console.log(`Raw widget contents (for signing) left at ${stagingDir}`);
console.log('Sign + install with the Tizen CLI once Tizen Studio is set up (see TIZEN-PLAN.md, Fase E):');
// `tizen package` must point at a directory whose ROOT contains config.xml
// directly (.tizen-staging, not dist-tizen) -- 2026-08-20 real incident:
// pointing it at dist-tizen instead zips up the already-built ninety-tv.wgt
// (and any other stray build artifact sitting there) as an opaque inner
// file rather than the actual widget contents, producing a package with no
// config.xml at its root. tizen install then fails with a NullPointerException
// in ConfigXMLUtil.getAppID (it silently no-ops when the config.xml path it
// expects doesn't exist, then dereferences the never-parsed doc). Kept the
// staging directory around (not cleaned up) specifically so this command
// has something valid to point at.
console.log(`  tizen package -t wgt -s <profile> -- ${stagingDir}`);
console.log('  tizen install -n <profile-output>.wgt -t <device-id>');

if (!existsSync(outFile)) {
  console.error('Expected output file was not created.');
  process.exit(1);
}
