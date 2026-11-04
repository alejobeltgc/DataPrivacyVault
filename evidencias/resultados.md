# Evidencias de PrivacyVault

- Fecha: 2026-11-03 22:10:05 -05
- Servicio: http://localhost:3001
- Generado por: `evidencias/run-tests.sh`

## 1. Anonymize

### 1. POST /anonymize

**Request**

```bash
curl -X POST http://localhost:3001/anonymize -H "Content-Type: application/json" -d '{"message":"oferta de trabajo para Carlos Mendoza con email cmendoza@example.com y teléfono 3001234567"}'
```

**Response** (HTTP 200)

```json
{
  "anonymizedMessage": "oferta de trabajo para NAME_c3a4591c41ee con email EMAIL_3f6ca58ba111 y teléfono PHONE_c5c8c0f0cfd0"
}
```

- ✔ Responde 200
- ✔ La respuesta no contiene PII

## 2. Deanonymize

### 2. POST /deanonymize

**Request**

```bash
curl -X POST http://localhost:3001/deanonymize -H "Content-Type: application/json" -d '{"anonymizedMessage":"oferta de trabajo para NAME_c3a4591c41ee con email EMAIL_3f6ca58ba111 y teléfono PHONE_c5c8c0f0cfd0"}'
```

**Response** (HTTP 200)

```json
{
  "message": "oferta de trabajo para Carlos Mendoza con email cmendoza@example.com y teléfono 3001234567"
}
```

- ✔ Devuelve el mensaje original exacto

### 3. POST /deanonymize

**Request**

```bash
curl -X POST http://localhost:3001/deanonymize -H "Content-Type: application/json" -d '{"anonymizedMessage":"hola NAME_000000000000"}'
```

**Response** (HTTP 404)

```json
{
  "error": "Token(s) no encontrado(s): NAME_000000000000"
}
```

- ✔ Un token que no existe responde 404 con error claro

## 3. Ciclo completo (anonymize → deanonymize)

### 4. POST /anonymize

**Request**

```bash
curl -X POST http://localhost:3001/anonymize -H "Content-Type: application/json" -d '{"message":"oferta de trabajo para Carlos Mendoza con email cmendoza@example.com y teléfono 3001234567"}'
```

**Response** (HTTP 200)

```json
{
  "anonymizedMessage": "oferta de trabajo para NAME_c3a4591c41ee con email EMAIL_3f6ca58ba111 y teléfono PHONE_c5c8c0f0cfd0"
}
```

- ✔ El token es determinista (mismo resultado que en el paso 1)

### 5. POST /deanonymize

**Request**

```bash
curl -X POST http://localhost:3001/deanonymize -H "Content-Type: application/json" -d '{"anonymizedMessage":"oferta de trabajo para NAME_c3a4591c41ee con email EMAIL_3f6ca58ba111 y teléfono PHONE_c5c8c0f0cfd0"}'
```

**Response** (HTTP 200)

```json
{
  "message": "oferta de trabajo para Carlos Mendoza con email cmendoza@example.com y teléfono 3001234567"
}
```

- ✔ El ciclo devuelve el mensaje original exacto

## 4. secureChatGPT

### 6. POST /secureChatGPT

**Request**

```bash
curl -X POST http://localhost:3001/secureChatGPT -H "Content-Type: application/json" -d '{"prompt":"Redacta un correo corto para Carlos Mendoza (cmendoza@example.com, teléfono 3001234567) invitándolo a una entrevista de trabajo el lunes."}'
```

**Response** (HTTP 200)

```json
{
  "response": "Asunto: Entrevista de trabajo – lunes\n\nHola Carlos Mendoza,  \nEspero que estés bien. Te escribo para invitarte a una entrevista de trabajo el lunes.  \n\nPor favor, confírmame tu disponibilidad.  \n\nQuedo atento/a.  \nSaludos,",
  "anonymizedPrompt": "Redacta un correo corto para NAME_694dd510f412 (EMAIL_5bf80f558c6c, teléfono PHONE_0882fb1a08d2) invitándolo a una entrevista de trabajo el lunes."
}
```

- ✔ Responde 200
- ✔ Lo enviado a OpenAI (anonymizedPrompt) no contiene PII
- ✔ La respuesta final contiene el nombre real
