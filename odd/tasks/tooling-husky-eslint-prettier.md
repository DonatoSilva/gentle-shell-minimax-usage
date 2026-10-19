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
- `lint-staged` corre solo sobre archivos *staged*, no sobre todo el repo.

## Acceptance criteria

- `npm run lint` exit 0.
- `npm run format:check` exit 0.
- `npm test` 48/48 exit 0.
- `npm run typecheck` exit 0.
- `git commit -m "bad message"` es rechazado por commitlint con mensaje claro.
- `git commit -m "feat(x): ok"` pasa el hook `commit-msg` y entra al flujo de
  pre-commit (lint-staged corre sobre staged files).

## Tasks

- [ ] T1 Editar `package.json` (deps + scripts) y crear configs (`.prettierrc.json`,
  `eslint.config.js`, `commitlint.config.js`). Route: inline.
- [ ] T2 Commit `chore(tooling): agregar husky, commitlint, eslint y prettier`
  con aprobación previa. Route: inline.
- [ ] T3 `npm install` (instala las nuevas devDeps) + `npm run format` (prettier
  escribe a todos los .ts/.json/.md) + `npm run lint:fix` (eslint --fix). Route:
  inline.
- [ ] T4 Commit `style: formatear con prettier y aplicar eslint --fix`. Route:
  inline.
- [ ] T5 Setup hooks: `npm run prepare` (husky init) + crear `.husky/commit-msg`
  y `.husky/pre-commit`. Sin commit; los hooks no se versionan pero `.husky/` sí.
  Route: inline.
- [ ] T6 Smoke: `git commit -m "bad"` debe ser rechazado por commitlint; commit
  con formato correcto debe pasar pre-commit + commit-msg. Route: inline.

## Risk

- Item 3 (contrato): los hooks cambian el flujo de commit — `commit-msg` rechaza
  mensajes que no siguen Conventional Commits. Aprobado por el usuario al pedir
  explícitamente el tooling.
- Item 6 (no test): no hay test que pruebe que los hooks *falle*. Se mitiga con
  el smoke test manual de T6.

## Log

- L1: usuario pidió "quiero agregar husky y commit lint y eslint y prettier".
  Aprobado formato total (opción A).