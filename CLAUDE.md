# PrivacyVault — reglas del proyecto (taller universitario)

Estas reglas aplican a todo el proyecto y prevalecen sobre cualquier convención
genérica de `.claude/` que las contradiga.

## Stack

- Node.js + Express + **JavaScript** (no TypeScript; ignora `typescript.instructions.md`).
- Detección de PII **solo con regex**. Sin librerías de NER.
- Puerto **3001**.

## Contrato de la API

- Los endpoints deben funcionar **EXACTAMENTE** con los `curl` que entregue el usuario.
- No cambiar rutas, métodos, nombres de campos ni formato de request/response.
- Ante cualquier duda sobre el contrato: preguntar, no suponer.

## Simplicidad

- Solución simple: sin arquitecturas complejas, capas ni abstracciones innecesarias.
- Buenas prácticas y un comentario breve en cada función (qué hace y por qué).

## Secretos

- Secretos solo en `.env`, nunca en el código ni en commits.
- Toda variable nueva se documenta en `.env.example` (sin valores reales).
- `.gitignore` incluye `node_modules` y `.env` desde el inicio.

## Fases

1. Vault con regex.
2. MongoDB.
3. OpenAI.

Al cerrar cada fase: verificar con los `curl` y hacer **un commit descriptivo**.

## PROMPTS.md

`PROMPTS.md` se llena automáticamente. **Nunca** borrarlo, reescribirlo ni editarlo.
