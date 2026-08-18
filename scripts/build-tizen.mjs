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

console.log('[4/4] cleanup');
rmSync(stagingDir, { recursive: true, force: true });

console.log(`\nUnsigned widget written to ${outFile}`);
console.log('Sign + install with the Tizen CLI once Tizen Studio is set up (see TIZEN-PLAN.md, Fase E):');
console.log('  tizen package -t wgt -s <profile> -- dist-tizen');
console.log('  tizen install -n ninety-tv.wgt -t <device-id>');

if (!existsSync(outFile)) {
  console.error('Expected output file was not created.');
  process.exit(1);
}
