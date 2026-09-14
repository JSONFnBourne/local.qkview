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
// NOT YET RUN: blackbriar has no node runtime (no nvm/volta/fnm, no apt nodejs,
// nothing on PATH), so this config is written from the installed packages'
// verified export shapes but has never been executed. RT#41 stays OPEN until
// `npm run lint` passes once on a machine with node.
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'

export default [
  ...nextCoreWebVitals,
  ...nextTypeScript,
]
