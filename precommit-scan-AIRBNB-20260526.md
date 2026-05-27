# Pre-Commit Security Scan — AIRBNB
**Date:** 2026-05-26 | **Verdict:** ✅ SAFE TO COMMIT

## Summary

| Severity | New (this commit) | Existing (pre-existing) |
|----------|:-----------------:|:-----------------------:|
| 🔴 Critical | 0 | 0 |
| 🟠 High | 0 | 0 |
| 🟡 Medium | 0 | 3 |
| 🟢 Low | 0 | 0 |
| **Total** | **0** | **3** |

**Risk Score: 37.3/100 (Moderate Risk)** — no new issues introduced by Task 8 changes.

---

## Findings (all pre-existing, not in staged files)

### Secrets (gitleaks) — existing
| # | Severity | Rule | File | Line | Remediation |
|---|----------|------|------|------|-------------|
| 1 | 🟡 Medium | jwt | `.env.local` | 3 | Move Supabase JWT to environment variable; add `.env.local` to `.gitignore` |
| 2 | 🟡 Medium | jwt/generic-api-key | `.next/` cache & build files | various | Add `.next/` to `.gitignore` to avoid committing build artifacts |

### Dependencies (npm audit + grype) — existing
| # | Severity | Package | CVE/GHSA | Remediation |
|---|----------|---------|----------|-------------|
| 1 | 🟡 Medium | postcss@8.4.31 | GHSA-qx2v-qp2m-jg93 | `npm update postcss` |
| 2 | 🟡 Medium | (2 npm moderate advisories) | — | Run `npm audit fix` |

### IaC/SAST — existing
- Checkov flagged JWT secrets in `gitleaks-report.json` (a scanner output file, not source code)
- Semgrep warnings on `security-report-*.html` (missing SRI integrity attribute) — scanner-generated HTML file

---

## Staged Files Checked (Task 8)
- `__tests__/actions/reservations.test.ts` — ✅ clean
- `actions/reservations.ts` — ✅ clean
- `app/(app)/calendar/page.tsx` — ✅ clean
- `components/calendar/CalendarView.tsx` — ✅ clean
- `components/calendar/ReservationBlock.tsx` — ✅ clean
- `components/calendar/ReservationForm.tsx` — ✅ clean
- `lib/utils.ts` — ✅ clean
