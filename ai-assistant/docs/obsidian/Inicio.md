---
title: ARIA — Inicio
aliases: [MOC, Índice ARIA]
tags: [aria, indice, moc]
updated: 2026-11-24
---

# ARIA — Inicio

> [!info] Qué es esta bóveda
> Documentación en **Obsidian** de todo el trabajo hecho en `PABLOESTRADA20/ai-assistant`.
> Es una capa de navegación: la fuente de verdad operativa sigue siendo [[Fuentes|la documentación original del repo]].

## Volante actual

`Aplicación → trazas → evaluación → escala`

- [[Proyecto]] — visión, arquitectura y stack.
- [[Estado actual]] — versiones, tests, auditoría y bloqueos.
- [[Cronología]] — qué pasó y cuándo.
- [[Decisiones]] — por qué se decidió cada cosa.
- [[Registro de PRs]] — PRs, merges y ramas.
- [[Pendientes]] — lo que falta y lo que no se puede tocar sin permiso.

## Fases

| Fase | Nota | Estado |
|---|---|---|
| 0 | [[Fases/Fase 0\|Ajustes del PC]] | ✅ Hecha |
| 1 | [[Fases/Fase 1\|Edición por parches]] | ✅ Hecha (aceptada en vivo) |
| 2 | [[Fases/Fase 2\|Verificación por CI]] | ✅ Hecha (aceptada en vivo) |
| 3 | [[Fases/Fase 3\|Índice de código]] | ✅ Hecha |
| 4 | [[Fases/Fase 4\|Memorias y notas auditadas]] | ✅ Hecha |
| 5 | [[Fases/Fase 5\|Clasificador de herramientas]] | ❌ Descartada |
| 6 | [[Fases/Fase 6\|LoRA aria-v1]] | ❌ Descartada |
| 7 | [[Fases/Fase 7\|Borrar, ramas libres y auto-fusión]] | 🟦 En curso |

## Áreas transversales

- [[Piloto/Piloto de trazas]] y [[Piloto/Trazas y evaluación]] — señal medible antes de reentrenar.
- [[Infraestructura]] — runtime, build, CI y variables de entorno.
- [[Seguridad]] — autenticación, WhatsApp, agente local y guardarraíles de git.
- [[Datos y privacidad]] — anonimización y archivos ignorados.
- [[Comandos]] — recetario de uso diario.
- [[Glosario]] — términos del proyecto.
- `Mapa.canvas` — vista gráfica de la bóveda.

> [!warning] Reglas que no cambian
> - No se escribe directamente en `main`: todo pasa por rama + PR + CI.
> - **Fase 6 sigue descartada**; el piloto no la reabre.
> - **Fase 7 no se cierra** hasta probarla con tokens y OAuth reales.
> - No se despliega, no se imprimen secretos y no se sube Prisma a v7 ni Next a v16 sin autorización.

## Cómo se mantiene

1. Leer [[Estado actual]] al empezar una sesión.
2. cerrar la sesión actualizando la nota de la fase correspondiente y [[Cronología]].
3. Si algo no se pudo verificar, va a [[Pendientes]], no se marca como hecho.
