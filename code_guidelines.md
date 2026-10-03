# Coding Guidelines

Guidelines for Claude Code and other coding agents working on projects.

## Design Patterns

* Don't Repeat Yourself (DRY) — extract shared logic into reusable functions/modules
* Single Responsibility Principle — each function/module/class does one thing well
* Use design patterns wisely — don't over-engineer; apply patterns when they solve a real problem
* Favor composition over inheritance
* Keep functions pure where possible — predictable inputs/outputs, minimal side effects
* Prefer explicit over implicit — no magic values, no hidden state mutations

## Defensive Programming

* **Validate at boundaries** — sanitize and type-check all input from users, APIs, files, env vars, and message queues; trust internal calls
* **Fail fast** — throw early with clear, actionable errors rather than letting bad state propagate
* **Use runtime validation for external data** — schema validators (e.g. Zod) for API payloads, config, and parsed JSON; don't rely on TypeScript types alone
* **Distinguish operational vs programmer errors** — operational (network down, bad input) → handle and recover; programmer (bug, invariant broken) → crash loudly
* **Never swallow errors silently** — log with context, rethrow, or escalate; an empty `catch {}` is almost always a bug
* **Guard against `null` and `undefined`** — use optional chaining, nullish coalescing, and explicit checks at boundaries; prefer non-nullable types internally
* **Handle the unhappy path explicitly** — timeouts on external calls, retries with backoff for transient failures, circuit breakers where appropriate
* **Make invalid states unrepresentable** — discriminated unions over boolean flags, branded types for IDs, exhaustive `switch` with `never` checks
* **Treat external data as untrusted** — escape/sanitize before rendering, parameterize queries, validate file paths against traversal
* **Prefer immutability** — `readonly` types, avoid mutating function arguments, return new objects instead of mutating in place
* **Idempotent operations where possible** — safe to retry; critical for webhooks, queue consumers, and migrations
* **Defense in depth** — don't rely on a single layer (e.g. UI validation + API validation + DB constraints)
* **Principle of least privilege** — minimal scopes for tokens, narrowest possible types, smallest possible API surface
* **Assert invariants** — use assertions or guard clauses for conditions that must hold; document the "why" when non-obvious

## Overall Principles

* Done is better than perfect — ship incremental value, iterate later
* Functions can have impact on other functions — consider side effects and coupling when making changes
* Code and product quality is always important — clean code, readable diffs, meaningful naming
* Bring value for the user — every feature and fix should serve a real user need
* Keep dependencies minimal — only add packages that solve a clear problem
* Write code for the next developer — clear naming, comments where "why" isn't obvious
* Small, focused commits — one logical change per commit with a descriptive message
* Refactor as you go — leave code better than you found it (Boy Scout Rule)

## Testing

* **Unit tests** — for pure functions and small code blocks with clear input → output
* **Integration tests** — for API routes; test the full request/response cycle including middleware, auth, and database
* **E2E tests** — out of scope for now
* Write tests before fixing bugs — reproduce the bug first, then fix it
* Test the unhappy path — invalid inputs, missing data, auth failures, network errors
* Keep tests independent — no shared mutable state between test cases
* Use descriptive test names that explain the expected behavior
* **Coverage targets** — aim for meaningful coverage, not a number for its own sake:
  * **Business logic / pure functions / utilities**: ≥ 85% — these are cheap to test and high-value
  * **API routes / services**: ≥ 75% — cover happy path + key error/auth branches
  * **UI components**: ≥ 50% — focus on logic-heavy components, hooks, and reducers; skip trivial presentational components
  * **Overall project target**: ≥ 70% for UI-heavy projects, ≥ 80% for backend-only projects
* Coverage is a floor, not a ceiling — 100% coverage with weak assertions is worse than 70% with meaningful ones
* Don't chase coverage on generated code, type definitions, or thin wrappers — exclude them from the report

## Security

Apply defense in depth — multiple independent layers, no single point of failure. Security is everyone's responsibility, not a final checklist.

### General Principles

* **Never trust input** — validate, sanitize, and escape data crossing any trust boundary (user, network, file, IPC)
* **Least privilege** — minimal permissions for tokens, service accounts, DB users, file access, container capabilities
* **Secure by default** — dangerous behavior should be opt-in, never opt-out
* **Don't roll your own crypto** — use vetted libraries (`argon2`, `bcrypt`, `jose`, platform `crypto`); never invent hashing or encryption
* **Fail closed** — on error or unexpected state, deny access rather than allow
* **Log security events** — auth failures, permission denials, rate-limit hits — but **never** log secrets, tokens, passwords, or full PII
* **Keep dependencies current** — outdated packages are the most common attack vector
* **Threat-model new features** — for any feature touching auth, payments, or user data, ask "what's the worst an attacker could do here?" before shipping

### Secrets Management

* Never commit secrets — `.env`, API keys, tokens, certs belong in a secret manager (1Password, AWS Secrets Manager, Vault, Doppler), not the repo
* Add `.env*` to `.gitignore`; commit `.env.example` with placeholder values and inline docs
* Rotate secrets on a schedule and immediately on suspected exposure
* Prefer short-lived tokens (OAuth, JWT with short TTL) over long-lived API keys
* Scope credentials narrowly — read-only where possible, per-environment, per-service
* Run a secret scanner in CI **and** as a pre-commit hook (see Automated Scanning below)

### Web Apps & APIs

* **Authentication** — use battle-tested libraries (Auth.js, Clerk, Lucia, Passport); never build your own login flow
* **Authorization** — check permissions on every request, server-side; never trust the client to enforce access
* **HTTPS only** — enforce TLS 1.2+, set HSTS, redirect HTTP → HTTPS
* **Security headers** — CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy (use Helmet on Node)
* **CORS** — explicit origin allowlist; never `*` for authenticated endpoints
* **CSRF** — `SameSite=Lax/Strict` cookies + CSRF tokens for state-changing requests from browsers
* **SQL injection** — parameterized queries / ORMs only; never string-concatenate SQL
* **XSS** — rely on framework auto-escaping (React, Vue, Svelte); sanitize raw HTML with DOMPurify; avoid `dangerouslySetInnerHTML` / `v-html`
* **SSRF** — validate and allowlist outbound URLs; never let user input drive server-side fetches unfiltered
* **Rate limiting** — per-IP and per-user; protect login, signup, password reset, and expensive endpoints
* **File uploads** — validate type & size, store outside web root, regenerate filenames, scan for malware
* **Sessions** — `httpOnly`, `secure`, `sameSite` cookies; rotate session IDs on login and privilege change

### Mobile & Desktop Apps

* Pin TLS certificates for high-trust API calls
* Store secrets in OS keychain / Keystore — never in plaintext config or `localStorage`
* Validate deep links and URL handlers — they're an attack surface
* Code-sign all release builds; verify signatures on update channels
* Obfuscate / minify production builds, but treat client code as public — never embed secrets

### CLI & Library Code

* Validate and sanitize any path, command, or shell argument before passing it to `exec`, `spawn`, or the filesystem
* Avoid `shell: true` in child processes — use argv arrays
* Be careful with `eval`, `Function()`, dynamic `require`, and YAML/JSON deserializers on untrusted input

### Data Protection

* Encrypt sensitive data at rest (DB-level or column-level for PII, secrets, tokens)
* Encrypt all data in transit (TLS 1.2+, mTLS for service-to-service where feasible)
* Minimize PII collection — only collect what you need; delete what you no longer need
* Hash passwords with `argon2id` (preferred) or `bcrypt` (cost ≥ 12) — never MD5, SHA1, or plain SHA256
* Mask sensitive values in logs, error messages, and analytics events

### Automated Security Scanning

Run these in CI and locally. Catching issues before merge is cheaper than catching them in production.

**GitHub-native (enable in repo settings):**

* **Dependabot** — automated dependency updates + vulnerability alerts
* **CodeQL** — GitHub's SAST engine; add via workflow template (Settings → Code security → Set up CodeQL)
* **Secret scanning + push protection** — blocks committing known secret patterns; free for public repos, available on Advanced Security for private

**GitHub Actions add-ons:**

* **Semgrep** (`returntocorp/semgrep-action`) — fast, customizable SAST with broad language coverage
* **gitleaks** (`gitleaks/gitleaks-action`) — secret scanning across full git history
* **trufflehog** (`trufflesecurity/trufflehog`) — secret detection with credential verification
* **Trivy** (`aquasecurity/trivy-action`) — container, IaC, and dependency scanning
* **Snyk** (`snyk/actions`) — dependency, container, and IaC scanning (free tier available)
* **OWASP ZAP** (`zaproxy/action-baseline`) — DAST against a deployed preview environment

**Pre-commit / pre-push (local — wire via `husky` + `lint-staged`):**

* `gitleaks protect --staged` — block secrets before they leave the dev machine
* `eslint` with `eslint-plugin-security` — flag common Node.js security anti-patterns
* `bun audit` / `npm audit --audit-level=high` — fail on high/critical vulns on pre-push
* `tsc --noEmit` — many security bugs are also type errors

**GitLab → GitHub equivalents:**

| GitLab template | GitHub equivalent |
| --- | --- |
| `Jobs/SAST.gitlab-ci.yml` | CodeQL workflow + Semgrep Action |
| `Jobs/Secret-Detection.gitlab-ci.yml` | Secret scanning (native) + gitleaks-action |
| `Jobs/Dependency-Scanning.gitlab-ci.yml` | Dependabot + Trivy or Snyk Action |

## Language Best Practices (TypeScript / Node.js)

* Enable strict mode in `tsconfig.json` — `"strict": true`
* Prefer `const` over `let`, avoid `var`
* Use proper TypeScript types — avoid `any`; use `unknown` when the type is genuinely unknown
* Handle promises properly — always `await` or `.catch()`, never leave unhandled rejections
* Use early returns to reduce nesting
* Prefer `async/await` over raw promise chains
* Use named exports over default exports for better refactoring support
* Keep environment config in one place — use a validated config module, not scattered `process.env` calls
* Use proper error types — extend `Error`, include context, distinguish operational vs programmer errors
* Prefer standard library and Node.js built-ins before reaching for npm packages

