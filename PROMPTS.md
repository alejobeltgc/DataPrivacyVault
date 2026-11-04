# Prompts del proyecto PrivacyVault

Prompts principales del taller, en orden cronológico y con su texto original. Cada uno va en un bloque para conservar el texto exacto.

## Preparación del proyecto

### Prompt 1 — Reglas del proyecto (CLAUDE.md)

```text
Vamos a construir un proyecto para un taller universitario. Antes de escribir código, crea un CLAUDE.md con estas reglas que debes respetar en todo el proyecto:

- Stack: Node.js + Express + JavaScript (no TypeScript). Detección de PII con regex. Puerto 3001.
- Los endpoints deben funcionar EXACTAMENTE con los curl que te daré; no cambies rutas, nombres de campos ni formato de request/response.
- Mantén la solución simple: sin arquitecturas complejas ni librerías de NER. Buenas prácticas y comentarios en las funciones.
- Secretos solo en .env (nunca en el código). Crea .env.example. El .gitignore debe incluir node_modules y .env desde el inicio.
- Trabajaremos por fases (1: vault con regex, 2: MongoDB, 3: OpenAI). Al cerrar cada fase haz un commit descriptivo.
- Existe un archivo PROMPTS.md que se llena automáticamente; no lo borres ni lo reescribas.

No escribas código todavía, solo confirma y crea CLAUDE.md, .gitignore y .env.example.
```

## Actividad 1 — Vault con regex (anonymize / deanonymize)

### Prompt 2 — Endpoint /anonymize

```text
I am creating a Data Privacy Vault so that PII (Personally identifiable information) becomes anonymized using node.js.

I need to start with the first step: have an endpoint so that it receives a single string with a message that contains PII like names, emails and phone numbers and returns it anonymized replacing the whole name, email and phone with an alphanumeric token.

Please act as an experienced node.js developer and tell me step by step how would you do it. Ask me for information whenever you need it and use good coding practices and comments in the functions.

An example of the request can be:
curl -X POST http://localhost:3001/anonymize -H "Content-Type: application/json" -d '{"message":"oferta de trabajo para Dago Borda con email dborda@gmail.com y teléfono 3152319157"}'

The response to that request would be:
{
"anonymizedMessage": "oferta de trabajo para d7e8e0bf bd673df2 con email b09bde30 y teléfono dd195b6c"
}
```

### Prompt 3 — Pruebas de nombres, teléfonos y mensajes sin PII

```text
Levanta el servicio y ejecuta el curl del ejemplo. Luego prueba también estos casos y muéstrame cada request con su respuesta:
1. Un mensaje que empiece con mayúscula ("Oferta para Ana María Pérez...") — la primera palabra NO debe tokenizarse.
2. Nombres con tildes y ñ (José Muñoz).
3. Teléfono con espacios o con +57.
4. Un mensaje sin PII (debe quedar igual).
Corrige lo que falle y explícame brevemente qué limitaciones tiene la detección de nombres con regex.
```

### Prompt 4 — Endpoint /deanonymize con tokens HMAC

```text
Thanks. Now, let's implement the deanonymize endpoint where the calling should be like this:
curl -X POST http://localhost:3001/deanonymize -H "Content-Type: application/json" -d '{"anonymizedMessage":"oferta de trabajo para NAME_e1be92e2b3a5 con email EMAIL_8004719c6ea5 y telefono PHONE_40e83067b9cb"}'
and should return the original message:
{"message":"oferta de trabajo para Dago Borda con email dborda@gmail.com y teléfono 3152319157"}

Nota: el ejemplo de anonymize y el de deanonymize usan formatos de token distintos. Unifica al formato con prefijo (NAME_, EMAIL_, PHONE_ + 12 hex), tokenizando el nombre completo como un solo token. Genera los tokens de forma determinista con HMAC-SHA256 usando un secreto en .env (TOKEN_SECRET), para que la misma PII produzca siempre el mismo token. Por ahora guarda los pares token-valor en memoria.
```

### Prompt 5 — Ciclo completo y commit de la fase 1

```text
Reinicia el servicio y prueba el ciclo completo: anonimiza el mensaje del ejemplo, toma el resultado y envíalo a deanonymize. Debe devolver el mensaje original exacto. Prueba también un token que no existe (debe responder con un error claro, no romperse). Muéstrame las respuestas y, si todo funciona, haz el commit de la fase 1. Utiliza commit wizard
```

## Actividad 2 — Persistencia en MongoDB

### Prompt 6 — Persistencia en MongoDB

```text
Fase 2: reemplaza el almacenamiento en memoria por persistencia en MongoDB usando mongoose. Debe guardar las parejas [información privada, token] con su tipo (NAME, EMAIL, PHONE) y fecha de creación, con índice único por token. La cadena de conexión debe leerse de MONGODB_URI en .env. Si la conexión falla al arrancar, el servicio debe mostrar un error claro. No cambies el contrato de los endpoints.
```

### Prompt 7 — Persistencia tras reiniciar y commit de la fase 2

```text
Ya configuré MONGODB_URI en .env. Levanta el servicio, verifica la conexión y repite el ciclo anonymize → deanonymize. Luego reinicia el servicio y vuelve a desanonimizar el mismo mensaje: debe funcionar porque ahora los datos persisten. Muéstrame las respuestas y haz el commit de la fase 2.
```

## Actividad 3 — OpenAI y /secureChatGPT

### Prompt 8 — Clase OpenAIService

```text
Fase 3: crea una clase OpenAIService (en su propio archivo) que use el SDK oficial de openai para hacer un text completion (chat completions). Debe leer OPENAI_API_KEY y OPENAI_MODEL desde .env, recibir un prompt y opcionalmente un system prompt, y devolver el texto de respuesta. Maneja errores de autenticación, límite de uso y timeout con mensajes claros. Verifica en la documentación actual del SDK la forma correcta de llamarlo.
```

### Prompt 9 — Endpoint /secureChatGPT

```text
Ahora crea el endpoint POST /secureChatGPT que:
1. Reciba {"prompt": "..."} con información privada (nombres, teléfonos, emails).
2. La anonimice usando las funciones ya implementadas.
3. Envíe el prompt anonimizado a ChatGPT usando la clase OpenAIService.
4. Reciba la respuesta y la desanonimice.
5. Devuelva la respuesta al cliente.

Incluye un system prompt que le indique al modelo conservar los tokens (NAME_xxx, EMAIL_xxx, PHONE_xxx) exactamente como aparecen, sin modificarlos ni traducirlos. Para efectos de evidencia, la respuesta debe incluir también el prompt anonimizado que se envió a OpenAI, para demostrar que la PII nunca salió del vault.
```

### Prompt 10 — Prueba de /secureChatGPT y tokens alterados

```text
Prueba /secureChatGPT con este curl y muéstrame la respuesta completa:
curl -X POST http://localhost:3001/secureChatGPT -H "Content-Type: application/json" -d '{"prompt":"Redacta un correo corto para Dago Borda (dborda@gmail.com, teléfono 3152319157) invitándolo a una entrevista de trabajo el lunes."}'

Verifica: (a) que lo enviado a OpenAI no contiene PII, (b) que la respuesta final sí contiene los datos reales, (c) qué pasa si el modelo altera un token. Si (c) es un problema, propón una mitigación simple. Luego haz el commit de la fase 3.
```

### Prompt 11 — Mitigación de tokens alterados

```text
aplica la mitigación de (c)
```

## Documentación

### Prompt 12 — README y organización de PROMPTS.md

```text
Genera un README.md con: descripción del proyecto y del problema que resuelve, arquitectura (un diagrama mermaid simple del flujo de secureChatGPT), requisitos, pasos de instalación, variables de entorno (referenciando .env.example), cómo correrlo y los curl de los tres endpoints con respuestas de ejemplo.

Luego organiza PROMPTS.md: conserva todos los prompts en orden pero agrégale encabezados por actividad (1, 2, 3) para que sea legible. No cambies el texto de los prompts.
```
