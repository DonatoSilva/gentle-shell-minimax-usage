# Tooling: husky, commitlint, eslint y prettier

## Objective

Agregar herramientas estándar de calidad al repo: hooks de git (husky), lint de
mensajes de commit (commitlint), lint de código (eslint) y formateo (prettier).
El usuario quiere las cuatro; los archivos existentes se reformatean una vez con
prettier para que el repo quede consistente desde el día uno.

## Decision (user-approved)

- Formatear **todo el código existente** con prettier en un commit aparte (no
  solo archivos nuevos). Diff ~1500 LOC en 17 archivos; se vio que el código ya
  está cerca del estilo prettier, así que el diff real debería ser chico.

## Scope

- In: deps en `package.json`, configs `.prettierrc.json` / `eslint.config.js` /
  `commitlint.config.js`, scripts (`prepare`, `lint`, `lint:fix`, `format`,
  `format:check`), hooks `.husky/commit-msg` y `.husky/pre-commit`, integración
  con `lint-staged`.
- Out: CI de GitHub Actions, prettier-plugin-organize-imports, reglas de
  eslint ad-hoc más allá del `recommended` de typescript-eslint.

## Constraints

- No romper `npm test` ni `npm run typecheck` (siguen verdes).
- Sin scope creep: configs mínimas razonables, sin debates de estilo.
- `eslint-config-prettier` desactiva las reglas de eslint que chocan con
  prettier (importante: si no, prettier re-formatea cosas que eslint luego
  marca).
- ESLint v9 usa flat config (`eslint.config.js`), no `.eslintrc`.
- Husky v9+: el setup es `husky init` + scripts ejecutables en `.husky/`.
- `lint-staged` corre solo sobre archivos _staged_, no sobre todo el repo.

## Acceptance criteria

- `npm run lint` exit 0.
- `npm run format:check` exit 0.
- `npm test` 48/48 exit 0.
- `npm run typecheck` exit 0.
- `git commit -m "bad message"` es rechazado por commitlint con mensaje claro.
- `git commit -m "feat(x): ok"` pasa el hook `commit-msg` y entra al flujo de
  pre-commit (lint-staged corre sobre staged files).

## Tasks

- [x] T1 Editar `package.json` (deps + scripts) y crear configs (`.prettierrc.json`,
      `eslint.config.js`, `commitlint.config.js`). Route: inline.
- [x] T2 Commit `chore(tooling): agregar husky, commitlint, eslint y prettier`
      con aprobación previa. Route: inline.
- [x] T3 `npm install` (instala las nuevas devDeps) + `npm run format` (prettier
      escribe a todos los .ts/.json/.md) + `npm run lint:fix` (eslint --fix). Route:
      inline.
- [x] T4 Commit `style: formatear con prettier y aplicar eslint --fix`. Route:
      inline.
- [x] T5 Setup hooks: `npm run prepare` (husky init) + crear `.husky/commit-msg`
      y `.husky/pre-commit`. Sin commit; los hooks no se versionan pero `.husky/` sí.
      Route: inline.
- [x] T6 Smoke: `git commit -m "bad"` debe ser rechazado por commitlint; commit
      con formato correcto debe pasar pre-commit + commit-msg. Route: inline.

## Risk

- Item 3 (contrato): los hooks cambian el flujo de commit — `commit-msg` rechaza
  mensajes que no siguen Conventional Commits. Aprobado por el usuario al pedir
  explícitamente el tooling.
- Item 6 (no test): no hay test que pruebe que los hooks _falle_. Se mitiga con
  el smoke test manual de T6.

## Log

- L1: usuario pidió "quiero agregar husky y commit lint y eslint y prettier".
  Aprobado formato total (opción A).

## Progress

- T1–T6 completos en la rama `dev`. Commits: `0721242` (deps + configs),
  `22ec5db` (formateo), `1b0c2cd` (hooks versionados).
- Verificación: `npm run lint` exit 0 · `npm run format:check` "All matched files
  use Prettier code style!" · `npm test` 48/48 exit 0 · `npm run typecheck`
  exit 0.
- Smoke de hooks: mensaje inválido rechazado por commitlint (`subject-empty`,
  `type-empty`); mensaje válido aceptado y commit creado. El commit de prueba
  se borró (el usuario corrió el `reset --hard` a mano).
- Gotcha: el script `prepare` (`husky`) NO corre en un `npm install` sobre un
  `node_modules` ya existente sin cambios en `package.json`. Hay que correr
  `npm run prepare` a mano para que se cree `.husky/` y se setee
  `core.hooksPath`. En un clone limpio sí corre solo.
- Gotcha: husky v9 usa `.husky/_/` como directorio interno; los hooks del
  usuario van en `.husky/<nombre>` y deben versionarse. `.husky/_/` va al
  `.gitignore`.
- Gotcha: `lint-staged` imprime `→ No staged files match any configured task.`
  cuando lo staged no matchea los patterns, pero NO falla el commit.
- Gotcha: `git commit --amend` funciona para reescribir un commit no pusheado y
  mantener un work unit en un solo commit. `git reset --hard` sí lo bloquea la
  política del harness.

## Review (RDD)

- `assess` sobre `origin/dev`..HEAD: `risk: medium`, `nativeRisk: high`, motivo
  `executable_mode` en `.husky/commit-msg` (mode 000000 -> 100755, intencional:
  los hooks de husky deben ser ejecutables). `reviewDue: true`.
- `inspect`: `status: ready`, `action: start`, target
  `sha256:bda49b2f02f630c85e89b92f79765668ef4bfc7045a4084bd6c29e3670a209d7`.
- START con lentes `["risk", "reliability", "readability"]`: el host resolvió el
  consent y el humano **declinó** el review de este candidato.
  `lineage_created: false`, `mutation_performed: false`, `mutation_outcome: none`.
- Disposición: **decline con scope de candidato**, no kill switch. No se reintentó
  START. `nativeReviewOutcome` queda `unknown` (no hay lineage ni candidato
  consumido, así que no se puede derivar `closed`).
- Plan vigente: `writerSelfVerification: true`, `independentVerifier: false`.
  Sin escalamiento: un hook mal configurado falla de forma ruidosa e inmediata en
  el siguiente commit, asi que el item 6 (fallo silencioso) no se sostiene.

### Verificacion propia en lugar del review (cubriendo el item 5)

- `prepare` + instalacion desde git (riesgo real: `prepare` corre en deps de git):
  `npm install git+file://...` -> exit 0, 1 paquete, 0 vulnerabilidades. El
  consumidor queda limpio: `.husky/` no se instala (excluido por `files`).
- `npm pack --dry-run`: 8 archivos, 6.6 kB — `.husky/` no se publica.
- Instalacion desde registry: `prepare` NO corre para deps de npm (npm solo lo
  ejecuta para deps de git), asi que los consumidores de una version nueva no
  arrastran las devDeps.
- Artefacto con el `package.json` nuevo, extraido fuera de `node_modules`:
  import + parse OK (`5h:55%`, `week:6%`).
- El path de credenciales (`resolveApiKey` en `lib/standalone-status.ts`) NO fue
  tocado por prettier: `unchanged`. El unico modulo de fuente reformateado fue
  `lib/parse-remains.ts`, que es un mapper puro sin credenciales.
