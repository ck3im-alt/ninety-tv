// Builds the Vite app and assembles an UNSIGNED intermediate Tizen .wgt.
//
// A .wgt is just a zip of the web app root + config.xml. This script
// deliberately stops there. What it produces is the INPUT to signing, not
// something installable: it contains config.xml only, and both a retail TV
// and Seller Office reject it.
//
// THREE PACKAGES, ONE OF WHICH THIS SCRIPT MAKES (see
// docs/BETA-RELEASE-CHECKLIST.md §D for the full table):
//
//   1. Unsigned intermediate      <- this script. config.xml only.
//   2. Developer-testing package  <- `tz pack`, Samsung VD Author + VD
//                                    DEVELOPER distributor certs. The
//                                    distributor cert is DUID-BOUND, so it
//                                    installs only on registered TVs. This
//                                    is the sideload/qualification package.
//   3. Seller Office upload       <- `tz pack` with the same AUTHOR cert.
//                                    Samsung REPLACES the pseudo-distributor
//                                    signature with the store's own during
//                                    store processing, so only the author
//                                    half is durable identity.
//
// Packages 2 and 3 both contain config.xml, author-signature.xml and
// signature1.xml. The author certificate must never change or be lost —
// Samsung requires the author information to match the existing version on
// every update — and must never be committed to this repository.
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

console.log(`\nUNSIGNED intermediate widget written to ${outFile}`);
console.log('This file is NOT installable on a TV and NOT uploadable to Seller Office — sign it first.');
console.log(`Raw widget contents (for signing) left at ${stagingDir}`);
console.log('Sign + install (see docs/TIZEN-DEVICE-TESTING.md for the full procedure):');
// NOTE ON `tizen package`: it is NOT the canonical path here and is kept in
// this comment only as a record of what was tried and why it fails. The
// verified signing command on this machine is `tz pack` (below). The
// directory-root caveat that follows applies to either tool.
//
// A packaging tool must point at a directory whose ROOT contains config.xml
// directly (.tizen-staging, not dist-tizen) -- 2026-08-20 real incident:
// pointing it at dist-tizen instead zips up the already-built ninety-tv.wgt
// (and any other stray build artifact sitting there) as an opaque inner
// file rather than the actual widget contents, producing a package with no
// config.xml at its root. tizen install then fails with a NullPointerException
// in ConfigXMLUtil.getAppID (it silently no-ops when the config.xml path it
// expects doesn't exist, then dereferences the never-parsed doc). Kept the
// staging directory around (not cleaned up) specifically so this command
// has something valid to point at.
// SIGNING IS `tz pack`, NOT `tizen package` -- 2026-08-28, measured on this
// machine. Both CLIs accept a profile named `ninety-tv`, but they read
// different profile stores: `tz` picks the Samsung VD author + VD DEVELOPER
// distributor certs a retail TV actually requires, while `tizen package`
// picks the generic Tizen Public Distributor TEST signer, which the TV
// rejects. Both commands succeed. Only one of the packages installs.
console.log(`  tz pack -b ${outFile} -t wgt -s ninety-tv -o ${resolve(root, 'dist-tizen', 'ninety-tv-signed.wgt')}`);
console.log('  tizen install -n ninety-tv-signed.wgt -s <TV_IP>:26101');

if (!existsSync(outFile)) {
  console.error('Expected output file was not created.');
  process.exit(1);
}
