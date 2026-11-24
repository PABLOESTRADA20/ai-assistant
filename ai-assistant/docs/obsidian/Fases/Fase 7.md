---
title: Fase 7 — Borrar, ramas libres y auto-fusión
tags: [aria, fase7, github, gitlab, oauth]
estado: en curso
fecha: 2026-10-16 a 2026-11-24
---

# Fase 7 — Escritura avanzada 🟦 En curso

## Petición del usuario

Que ARIA pueda **agregar, borrar y modificar** archivos, conectarse con varias plataformas e **iniciar sesión**, y crear ramas. Decisiones tomadas el 2026-10-16:

- Llegar a `main`: **fusionar sola, solo si las pruebas pasan**. Nunca escritura directa.
- Capacidades nuevas: borrar archivos, ramas con nombre libre, modificar archivos.
- Plataformas/login: GitHub + GitLab + OAuth, **solo para el propio usuario** (no multiusuario).

## Parte A — hecha

- `github_delete_file`: borra archivos abriendo un PR (rama nueva o existente). Nunca borra carpetas enteras ni `.github/workflows`; respeta el tope de 10 archivos (`deleteFiles` en `app/lib/github.ts`).
- **Ramas con nombre libre**: `applyPatch`, `createPullRequest` y `deleteFiles` aceptan cualquier nombre válido (`isValidBranchName`), salvo la rama principal (`validateBranch`). Se quitó el prefijo `aria/*`.
- `github_merge_pull_request`: vuelve a consultar los checks antes de fusionar; rechaza si están en cola o fallidos; avisa si el repo no tiene checks; no fuerza si hay conflictos. Interruptor aparte `GITHUB_AUTO_MERGE=true` (activar escritura no arrastra fusión).
- Prompt, `RX_GITHUB`/`RX_GITHUB_WRITE` y `TOOL_GROUPS.githubWrite` actualizados; el prompt sigue ≤900 tokens.
- Docs: `README.md` y `.dev.vars.example`.
- Tests: 15 en `tests/unit/github-write.test.ts` + actualizaciones en `github-patch` y `select-tools`: borrado, rechazo de rama principal, rutas prohibidas, CI en verde/en cola/fallido/ausente/conflicto y validación de nombres.

### Matiz de la auto-fusión

Si el repo **no tiene checks**, se permite fusionar **avisando**: exigir `success` bloquearía para siempre a los repos sin CI. Se distingue `none` (sin checks) de `pending` (en cola), que sí bloquea.

## Parte B — en curso

- Capa de proveedores: `app/lib/git-hosts.ts` + `app/lib/git-common.ts` y distribuidor `app/lib/git.ts`. **GitHub** y **GitLab v4** implementados; Bitbucket reconocido pero no implementado.
- **Tokens por plataforma** por entorno (`GITHUB_TOKEN`, `GITLAB_TOKEN`, `BITBUCKET_TOKEN`), sin almacenamiento en BD.
- **Ruteo unificado**: `owner/repo` → GitHub; `gitlab:grupo/proyecto` o URL de GitLab → GitLab. Las herramientas siguen llamándose `github_*`.
- GitLab a nivel código: leer/escribir por rama, abrir MR, consultar pipelines/checks y auto-fusión con CI en verde (mismos guardarraíles que GitHub).
- Endpoint `/api/platforms` muestra qué plataformas tienen token/configuración; la UI acepta `gitlab:` y URLs.

### OAuth en código (2026-11-24)

- `/api/auth` devuelve `required` y la lista de proveedores configurados; el cliente filtra valores desconocidos y muestra los botones en [[Seguridad|la pantalla de acceso]].
- `/api/auth/oauth/start` guarda un `state` anti-CSRF en una cookie `HttpOnly` (`aria_oauth_state`, 10 min) y redirige a GitHub/Google con `scope`, `redirect_uri` y `state`.
- `/api/auth/oauth/callback` exige que el `state` de la URL coincida con la cookie, canjea el `code` por un token, lee el perfil (en GitHub completa el email principal verificado) y **solo** entra si la identidad está en la lista blanca de un usuario.
- La sesión se firma con HMAC-SHA256 (`ARIA_SESSION_SECRET`, o `ARIA_ACCESS_TOKEN` si no hay) y se entrega por `localStorage`, nunca en la URL. Viaja en `Authorization: Bearer`, así que el SSE del chat queda intacto. La cookie `aria_token` sigue sin autorizar.
- Tests: `tests/unit/oauth.test.ts` (helpers, canje y sesiones), `oauth-routes.test.ts` (rutas con `fetch` inyectado), `auth-client.test.ts` y `auth.test.ts`. Sin red ni BD real.
- **Pendiente:** OAuth **real** (apps de GitHub/Google + secretos + redirect URI) y prueba en vivo de GitLab con token real.
- **Pendiente:** prueba en vivo de `github_delete_file` y `github_merge_pull_request` con CI verde. `GITHUB_AUTO_MERGE` debe quedar en `false` salvo durante esa prueba.

## Guardarraíles que no se relajan

- ARIA **nunca** escribe directo en `main`.
- La fusión exige CI en verde (o, explícitamente, aviso de "sin checks").
- La auto-fusión tiene interruptor propio, distinto del de escritura.
- Los nombres de rama se validan para evitar inyección de referencias en la API.
- Auth de la app acepta solo `Authorization: Bearer` (clave compartida **o** sesión OAuth firmada); la cookie `aria_token` ya no autoriza. Ver [[Seguridad]].

## Cierre

**Fase 7 no se cierra** hasta probarla con tokens y OAuth reales, y verificar el webhook de WhatsApp y el deploy en Cloudflare. Ver [[Pendientes]].

## Enlaces

[[Inicio]] · [[Seguridad]] · [[Infraestructura]] · [[Pendientes]] · [[Registro de PRs]]
