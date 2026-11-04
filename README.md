# PrivacyVault

Data Privacy Vault en Node.js: anonimiza la información personal (PII) de un texto, la guarda cifrada por token en MongoDB y permite usar ChatGPT **sin que la PII salga del vault**.

## El problema

Cuando una aplicación envía texto a un servicio externo (un LLM, un log, un proveedor de analítica), suele mandar también nombres, emails y teléfonos de personas reales. PrivacyVault se interpone:

1. **Detecta** nombres, emails y teléfonos con expresiones regulares.
2. **Reemplaza** cada dato por un token (`NAME_…`, `EMAIL_…`, `PHONE_…`) y guarda la pareja token ↔ valor en MongoDB.
3. **Revierte** los tokens cuando el texto vuelve, para que el usuario final vea los datos reales.

Así, por ejemplo, ChatGPT redacta un correo para `NAME_c2192b5767a4` y el cliente recibe el correo para "Carlos Mendoza".

## Arquitectura

Un solo servicio Express (`index.js`) con tres endpoints, MongoDB Atlas como vault y la clase `OpenAIService` (`openaiService.js`) para ChatGPT.

Flujo de `POST /secureChatGPT`:

```mermaid
sequenceDiagram
    participant C as Cliente
    participant API as PrivacyVault (Express)
    participant DB as MongoDB (vault)
    participant AI as OpenAI

    C->>API: POST /secureChatGPT { prompt }
    API->>API: Detecta PII (regex) y genera tokens HMAC
    API->>DB: Guarda token ↔ valor (upsert)
    API->>API: Cambia tokens por alias aleatorios de esta petición
    API->>AI: Prompt con alias + system prompt "conserva los tokens"
    AI-->>API: Respuesta con alias
    API->>API: Cambia alias por los valores reales
    API-->>C: { response, anonymizedPrompt }
```

Decisiones clave:

- **Tokens deterministas** (`HMAC-SHA256` con `TOKEN_SECRET`): la misma PII produce siempre el mismo token, y sin el secreto no se pueden revertir.
- **Alias por petición hacia OpenAI**: OpenAI nunca ve los tokens del vault, así que no puede relacionar a la misma persona entre peticiones. La respuesta solo se desanonimiza con los alias de esa petición.
- **Solo localhost**: el servidor escucha en `127.0.0.1`, rechaza cabeceras `Host` ajenas (DNS rebinding) y limita `/secureChatGPT` a 20 peticiones por minuto.

## Requisitos

- Node.js **22 o superior** (lo exige el SDK de OpenAI; probado con Node 24).
- Un cluster de **MongoDB Atlas** (el tier gratuito sirve) con un usuario de base de datos.
- Una **API key de OpenAI** con créditos.

## Instalación

```bash
git clone <url-del-repo> PrivacyVault
cd PrivacyVault
npm ci
cp .env.example .env
```

Después edita `.env` con tus valores (ver la sección siguiente). Para generar `TOKEN_SECRET`:

```bash
openssl rand -hex 32
```

## Variables de entorno

Todas se leen de `.env`, que nunca se sube al repositorio (`.gitignore`). La plantilla es [`.env.example`](.env.example).

| Variable | Obligatoria | Descripción |
|---|---|---|
| `PORT` | No | Puerto del servidor. Por defecto `3001`. |
| `TOKEN_SECRET` | Sí | Secreto del HMAC de los tokens. Si cambia, los tokens ya guardados dejan de coincidir. |
| `MONGODB_URI` | Sí | Cadena de conexión de Atlas: `mongodb+srv://USUARIO:CLAVE@cluster.xxxxx.mongodb.net/privacyvault`. Si la clave tiene `@ : / ? # %`, codifícalos con `encodeURIComponent`. |
| `OPENAI_API_KEY` | Solo para `/secureChatGPT` | API key de OpenAI. |
| `OPENAI_MODEL` | Solo para `/secureChatGPT` | Modelo de chat, por ejemplo `gpt-4o-mini`. |

Si falta `TOKEN_SECRET` o `MONGODB_URI`, o la conexión a MongoDB falla, el servicio no arranca y muestra un error claro. Si falta la configuración de OpenAI, `/anonymize` y `/deanonymize` siguen funcionando y `/secureChatGPT` responde `503`.

## Cómo correrlo

```bash
npm start   # levanta el servicio en http://localhost:3001
npm test    # corre los tests
```

Los tests usan tu `MONGODB_URI`, pero en una base aparte (`privacyvault_test`) que se vacía en cada corrida; nunca tocan la base real. Los tests de `OpenAIService` no salen a la red (simulan las respuestas de OpenAI).

## Endpoints

Los tokens de los ejemplos son ilustrativos: dependen de tu `TOKEN_SECRET`.

### `POST /anonymize`

```bash
curl -X POST http://localhost:3001/anonymize -H "Content-Type: application/json" -d '{"message":"oferta de trabajo para Carlos Mendoza con email cmendoza@example.com y teléfono 3001234567"}'
```

```json
{"anonymizedMessage":"oferta de trabajo para NAME_e34ed97f71f1 con email EMAIL_25908f87ed63 y teléfono PHONE_ef7914fb78d4"}
```

### `POST /deanonymize`

Recibe el texto con los tokens que devolvió `/anonymize`:

```bash
curl -X POST http://localhost:3001/deanonymize -H "Content-Type: application/json" -d '{"anonymizedMessage":"oferta de trabajo para NAME_e34ed97f71f1 con email EMAIL_25908f87ed63 y teléfono PHONE_ef7914fb78d4"}'
```

```json
{"message":"oferta de trabajo para Carlos Mendoza con email cmendoza@example.com y teléfono 3001234567"}
```

Si algún token no existe en el vault responde `404`:

```json
{"error":"Token(s) no encontrado(s): NAME_000000000000"}
```

### `POST /secureChatGPT`

```bash
curl -X POST http://localhost:3001/secureChatGPT -H "Content-Type: application/json" -d '{"prompt":"Redacta un correo corto para Carlos Mendoza (cmendoza@example.com, teléfono 3001234567) invitándolo a una entrevista de trabajo el lunes."}'
```

```json
{
  "response": "Asunto: Entrevista de trabajo — lunes\n\nHola Carlos Mendoza:\n\nTe invito a una entrevista de trabajo el lunes. Por favor, confírmame tu disponibilidad.\n\nQuedo atento/a.\n\nTeléfono: 3001234567\nCorreo: cmendoza@example.com",
  "anonymizedPrompt": "Redacta un correo corto para NAME_c2192b5767a4 (EMAIL_bd74abf3676d, teléfono PHONE_2cddf3c951d1) invitándolo a una entrevista de trabajo el lunes."
}
```

`anonymizedPrompt` es exactamente lo que se envió a OpenAI: sirve como evidencia de que la PII no salió del vault.

### Errores

Todos los errores responden `{"error": "..."}` con un mensaje claro y sin detalles internos:

| Código | Cuándo |
|---|---|
| `400` | Falta el campo, no es un string o el JSON está mal formado. |
| `403` | La cabecera `Host` no es `localhost` ni `127.0.0.1`. |
| `404` | `/deanonymize` recibe un token que no existe. |
| `413` | Más de 200 datos privados distintos en un mensaje, o un prompt de más de 20 000 caracteres. |
| `429` | Más de 20 peticiones por minuto a `/secureChatGPT`, o OpenAI rechaza por límite o por falta de créditos. |
| `502` / `504` | OpenAI rechaza la API key, falla o no responde a tiempo. |
| `503` | OpenAI no está configurado en el servidor. |

## Limitaciones conocidas

- La detección es por regex, sin NER. No detecta nombres en minúscula ni un nombre de una sola palabra al inicio de una frase (`"Ana vino"`). Al revés, a veces tokeniza palabras capitalizadas que no son nombres (`"Su email…"`, `"Hola Juan"` como un solo token). Lo que no se detecta sí llega a OpenAI.
- No hay autenticación: cualquiera con acceso a `localhost` puede desanonimizar. Antes de exponer el servicio hacen falta autenticación y un rate limit por cliente.
- En MongoDB la PII se guarda en claro; solo la protege el cifrado en disco de Atlas.

## Estructura

```
index.js                 servicio Express: detección, vault (MongoDB) y endpoints
openaiService.js         clase OpenAIService (chat completions y manejo de errores)
index.test.js            tests del vault y de /secureChatGPT (usa privacyvault_test)
openaiService.test.js    tests de OpenAIService, sin red
.env.example             plantilla de variables de entorno
```
