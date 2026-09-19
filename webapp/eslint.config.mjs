// ESLint flat config (RT#41).
//
// WHY THIS FILE EXISTS: `next lint` was REMOVED in Next.js 16 — not deprecated.
// Verified statically against the installed next@16.2.4 rather than from release
// notes: node_modules/next/dist/cli/ contains next-build / next-dev / next-start
// / next-info / next-test / next-typegen / next-upgrade and friends, but there is
// NO next-lint.js, and node_modules/next/dist/bin/next dispatches only
// next-build, next-dev and next-start. So `"lint": "next lint"` was a dead script.
//
// There was also no ESLint config of any kind in this directory, so simply
// swapping the script to `eslint .` would have replaced one failure with another.
//
// eslint-config-next@16.2.2 ships FLAT config arrays (each dist/*.js ends
// `module.exports = config` where config is an array), so they spread directly.
// Both already carry ignores for .next/**, out/**, build/** and next-env.d.ts —
// do not duplicate those here.
//
// VERIFIED 2026-09-18 on a host with node 22 (outcome) after a fresh `npm ci`:
// `npm run lint` executes, loads this config, and reports real findings in
// app/ (tracked separately). Note that a node_modules tree whose .bin/ entries
// have been flattened from symlinks into plain files (the 2026-07 copy on
// blackbriar) makes `npm run lint` fall through to whatever `eslint` is on
// PATH — on outcome that was a global ESLint 6, which cannot read flat config
// and reports "couldn't find a configuration file". A fresh install fixes it.
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'

const config = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
]

export default config
