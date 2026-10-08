# Configuración de GHL, n8n y el panel de Frutitodo

## 0. Flujo completo

```
Cliente (WhatsApp)
   │
   ▼
Agente de GHL reconoce una lista completa, el fin de la selección o un cambio posterior
   │  ejecuta una sola acción "Enviar Pedido a n8n" con los datos del contacto
   ▼
Workflow GHL → Custom Webhook → n8n  (frutitodo-pedido-ia.json)
   1. normaliza body/customData, busca la conversación y lee hasta 30 mensajes
   2. conserva solo los mensajes del día actual en America/Bogota, incluidas imágenes
   3. OpenAI reconstruye la lista completa del día y separa consultas de precio de compras
   4. POST único a /orders/upsert; Supabase decide si actualiza el pedido vigente o crea uno
   5. escribe de vuelta en el contacto: resumen fiel, cédula, método de pago, número y estado
   ▼
Panel (iframe): Nuevos → En preparación → Despachados · Requiere ayuda · Productos y precios
   │  cotizar (precios del catálogo) → enviar por WhatsApp con la API de GHL
   │  imprimir comanda con precios / despachar
   ▼
Panel → n8n (frutitodo-eventos-panel.json) → GHL: estado del pedido y aviso de despacho

IA pide ayuda → etiqueta `requiere_ayuda` → workflow GHL → n8n (frutitodo-solicitud-ayuda.json)
   → panel: tarjeta roja con botón "Abrir conversación"
```

Los tres workflows de n8n están en la carpeta [`n8n/`](../n8n) y se importan con **Import from File**.

## 1. Base de datos

Aplicar todas las migraciones pendientes, incluida `20261007231323_flexible_orders_and_courier_access.sql`:

```powershell
npx.cmd supabase db push --dry-run
npx.cmd supabase db push
```

Agregan a los pedidos: cédula, método de pago, conversación de GHL, origen (IA o manual), texto original, quién imprimió o despachó y la cotización. También permiten dirección pendiente y crean una credencial limitada para domiciliarios.

**Sin estas migraciones el panel desplegado falla**: aplícalas antes o justo después del push.

## 2. Campos personalizados del contacto

| Nombre | Clave | Tipo | Quién lo escribe |
|---|---|---|---|
| Pedido resumen | `pedido_resumen` | Texto largo | n8n, con el pedido ya extraído y formateado |
| Documento de identidad | `documento_de_identidad` | Texto | n8n (la IA lo lee, no lo escribe) |
| Dirección de envío | `direccion_de_envio` | Texto largo | n8n, solo en domicilios (la IA lo lee, no lo escribe) |
| Método de pago | `metodo_pago` | Texto | n8n |
| Último pedido número | `ultimo_pedido_numero` | Texto | n8n (`FT-000123`) |
| Último pedido estado | `ultimo_pedido_estado` | Texto | n8n: `nuevo`, `en_preparacion`, `despachado` |
| Último pedido total | `ultimo_pedido_total` | Texto | El panel, al enviar la cotización |

La IA **no escribe ningún campo**: solo los lee al empezar (`{{contact.documento_de_identidad}}`, `{{contact.direccion_de_envio}}`) para no volver a preguntarlos. Quita del agente las acciones de "actualizar campo" de resumen y documento. Si GHL genera claves distintas, cámbialas en el nodo **Config** de cada workflow (`CF_*`). Si la API ignora la clave, usa el ID del campo (Configuración → Campos personalizados).

Los campos `pedido_evento_id`, `pedido_productos_json`, `pedido_tipo_entrega`, `pedido_direccion` y `pedido_observaciones` del flujo anterior dejan de usarse, porque ahora n8n hace la extracción.

## 3. Prompt del agente

El prompt completo está en [prompt-agenteia.md](prompt-agenteia.md). Lo que importa para la integración:

1. Una lista completa escrita o en imagen se envía desde el primer mensaje, aunque falten cédula, dirección, pago o confirmación. Si el cliente pide producto por producto, se envía cuando indique que terminó.
2. La IA **no guarda campos** del contacto; n8n los escribe después de extraer el pedido.
3. n8n reconstruye el pedido con los mensajes del día actual. Cada producto se conserva como lo escribió el cliente aunque no aparezca en las KB o no coincida con el catálogo; marca, presentación, preparación y demás características permanecen en su propia línea.
4. **Cualquier afirmación** del cliente confirma ("sí", "correcto", "dale", "listo", 👍…). Si agrega o cambia algo, la IA vuelve a mostrar el resumen completo.
5. El agente ejecuta una sola acción **Enviar Pedido a n8n**. La acción significa “procesa la conversación ahora”; no significa crear ni ajustar.
6. El endpoint único consulta Supabase: si el contacto tiene un pedido `pending` o `printed` lo reemplaza con la lista completa reconstruida y conserva el número; si no tiene uno vigente, crea un pedido nuevo. Un pedido impreso vuelve a *Nuevos* con **Ajuste · reimprimir**.
7. **"Solicitar Ayuda"** (incidencias, estado del pedido, hablar con una persona) debe agregar la etiqueta `requiere_ayuda` (workflow 4.3).
8. Si pregunta precio, la IA pide la lista completa una sola vez; si insiste por segunda vez, ejecuta **"Solicitar Ayuda"**. La reactivación al resolver la tarjeta es automática y no forma parte del prompt.
9. La dirección no bloquea un pedido: se toma la guardada en el CRM y, si falta, el panel advierte al domiciliario que contacte al cliente antes de despachar.
10. “5 mil de papa”, “$7.000 de queso” y expresiones equivalentes son cantidades por valor válidas.
11. El agente no pregunta método de pago ni billete. Si el cliente lo menciona espontáneamente, n8n lo conserva; de lo contrario el equipo puede completarlo después.
12. La IA no da precios ni totales: la cotización la envía una persona desde el panel.

## 4. Workflows de GHL

Todos usan un **Custom Webhook** `POST` con estos headers:

- `Content-Type: application/json`
- `x-frutitodo-secret: <INBOUND_SECRET>`, el mismo valor que pongas en el nodo Config de n8n.

### 4.1 Acción única Enviar Pedido a n8n

**Descripción para pegar en la tool:** `Procesa el pedido de la conversación actual. Úsala al recibir una lista completa o imagen, cuando el cliente termine de agregar productos o cuando modifique un pedido ya enviado.`

- **Disparador:** la workflow action **Enviar Pedido a n8n** ejecutada por el agente. Debe poder ejecutarse más de una vez en la misma conversación.
- **URL:** `https://<tu-n8n>/webhook/frutitodo-pedido`
- **Body:**

```json
{
  "locationId": "{{location.id}}",
  "contactId": "{{contact.id}}",
  "contactName": "{{contact.name}}",
  "contactPhone": "{{contact.phone}}",
  "contactDocument": "{{contact.documento_de_identidad}}",
  "contactAddress": "{{contact.direccion_de_envio}}"
}
```

Los mismos valores pueden llegar dentro de `customData` usando estas claves o sus variantes `snake_case`; el nodo **Normalizar entrada** acepta ambas formas. n8n lee los últimos `MESSAGE_LIMIT` mensajes (30 por defecto), descarta todos los que no sean del día actual en `America/Bogota` y usa como idempotencia el último mensaje entrante del cliente.

Si una línea de la lista no trae cantidad, n8n no la elimina: conserva la frase literal y usa internamente cantidad `1` sin unidad como marcador provisional para que el operario pueda corregirla en el panel.

Configura en el prompt tres disparadores para esa misma acción: (1) lista completa o imagen, (2) el cliente termina de escoger productos uno a uno y (3) agrega, quita o corrige algo después. No configures acciones separadas **Pedido Confirmado** y **Anexo a Pedido**. Las consultas de precio, saludos y mensajes sin intención de compra terminan con `200 ignored` y no crean pedidos ni solicitudes de ayuda.

### 4.2 Cliente requiere ayuda

- **Disparador:** *Contact Tag Added* = `requiere_ayuda` (la agrega la acción "Solicitar Ayuda" del agente)
- **Acción 1:** Custom Webhook a `https://<tu-n8n>/webhook/frutitodo-ayuda`

```json
{
  "locationId": "{{location.id}}",
  "contactId": "{{contact.id}}",
  "contactName": "{{contact.name}}",
  "contactPhone": "{{contact.phone}}",
  "reason": "La IA solicitó ayuda de un asesor"
}
```

- **Acción 2:** *Remove Tag* `requiere_ayuda`, para que la siguiente solicitud vuelva a disparar el workflow.

n8n busca el `conversationId` con la API de GHL (`GET /conversations/search`). El panel arma el enlace directo:

```
https://app.iaorbita.com/v2/location/<location>/conversations/conversations/<conversationId>
```

Si no encuentra la conversación, el enlace abre la ficha del contacto. Si un cliente pide ayuda dos veces, el panel no duplica la tarjeta: muestra "Pidió ayuda 2 veces".

## 5. n8n

1. Importa los tres archivos de `n8n/`.
2. Completa el nodo **Config** de cada workflow:
   - `GHL_TOKEN`: Private Integration token de la subcuenta, con permisos `contacts.write`, `conversations.readonly` y `conversations/message.write`.
   - `APP_INGEST_SECRET`: el mismo valor que `GHL_INGEST_SECRET` en Vercel.
   - `OPENAI_API_KEY` y `OPENAI_MODEL`. El valor por defecto es `gpt-5.6-luna`; **confirma el ID exacto del modelo en tu cuenta de OpenAI**.
   - `INBOUND_SECRET` / `APP_WEBHOOK_SECRET`: secretos compartidos.
3. Activa los tres workflows y copia la **Production URL** de cada Webhook.
4. En Vercel, en el proyecto `pedidos-frutitodo-eight`, con scope Production:
   - `N8N_DISPATCH_WEBHOOK_URL` = Production URL de *Frutitodo · Eventos del panel → GHL* (`/webhook/frutitodo-eventos`)
   - `N8N_WEBHOOK_SECRET` = el `APP_WEBHOOK_SECRET` de ese workflow
   - Vuelve a desplegar, porque Vercel incorpora las variables al build.

`SEND_CONFIRMATION` (workflow de pedidos) envía por WhatsApp "Recibimos tu pedido FT-…" o "Ajustamos tu pedido FT-… (es el mismo pedido)". Viene en `false` porque un mensaje enviado por API puede pausar la IA en esa conversación y porque la IA ya confirma. Actívalo solo después de probarlo.

### Eventos que la app envía a n8n

Todos llegan a la misma URL con `Authorization: Bearer <N8N_WEBHOOK_SECRET>` y se distinguen por `event`:

| Evento | Cuándo | Qué hace n8n |
|---|---|---|
| `order.printed` | Se confirma una impresión | `ultimo_pedido_estado = en_preparacion` |
| `order.dispatched` | Se marca despachado | `ultimo_pedido_estado = despachado` y WhatsApp "va en camino" (texto provisional; pedir a Frutitodo el definitivo) |

Cuerpo común:

```json
{
  "event": "order.dispatched",
  "requestId": "<id único del clic>",
  "ghlLocationId": "UfbKDvUAPCDEaRQWYXau",
  "ghlContactId": "<contacto o null si es manual>",
  "operator": "Isabel",
  "order": { "orderNumber": "FT-000021", "customerName": "…", "paymentMethod": "…", "deliveryType": "domicilio", "…": "…" }
}
```

Impresión y despacho se avisan después de responderle al panel: el operario nunca espera a n8n. La cotización **no pasa por n8n**: el panel la envía directo con la API de GHL (sección 9).

## 6. Menú embebido

Crear el Custom Menu Link **Pedidos Frutitodo** con apertura **Embedded Page (iFrame)** y limitarlo a los roles operativos. `location` y `token` van **escritos literalmente**:

```text
https://pedidos-frutitodo-eight.vercel.app/panel?location=UfbKDvUAPCDEaRQWYXau&token=<TOKEN>&user={{user.name}}
```

`&user={{user.name}}` sirve para que el tiquete diga quién imprimió. **Hay que probarlo:** si GHL lo reemplaza, el panel muestra el nombre arriba a la derecha. Si no lo reemplaza, el panel lo ignora y pide "¿Quién está de turno?" (se guarda en esa tablet). Con usuarios de GHL por asesor, cada turno queda registrado.

`<TOKEN>` se genera con:

```powershell
npm.cmd run provision:location -- --location-id UfbKDvUAPCDEaRQWYXau --name "COL - Frutitodo"
```

Después de aplicar la migración de acceso flexible, crea el enlace limitado para domiciliarios sin reemplazar el token operativo:

```powershell
npm.cmd run provision:location -- --location-id UfbKDvUAPCDEaRQWYXau --name "COL - Frutitodo" --role courier
```

Usa la URL que imprime ese comando en un Custom Menu Link visible solo para el rol de domiciliarios.

Cada ejecución reemplaza el token anterior del mismo rol, así que hay que actualizar el enlace correspondiente. Supabase guarda solo el HMAC del token con `EMBED_TOKEN_PEPPER`: si se pierde, se regenera. El token es a la vez credencial, rol y aislamiento entre locations; trátalo como secreto.

**No usar `{{custom_values.*}}` en el enlace:** los Custom Menu Links no resuelven custom values y el panel mostraría `Enlace de acceso incompleto`. El panel también acepta el formato con fragmento (`/panel#location=...&token=...`) y los alias `location_id` y `panel_token`.

### Botón "Abrir conversación"

Usa `target="_top"`: la ventana de GHL cambia a la conversación sin abrir pestañas nuevas. El dominio se puede cambiar con `NEXT_PUBLIC_GHL_APP_URL` (por defecto `https://app.iaorbita.com`).

### Dominio en uso

`https://pedidos-frutitodo-eight.vercel.app` es el proyecto de Vercel conectado a GitHub. El dominio corto `pedidos-frutitodo.vercel.app` pertenece a un proyecto viejo. Si algún día se reclama, hay que actualizar a la vez el menú, n8n (`APP_URL`) y este documento.

## 7. Dominio del iframe

El panel responde con `Content-Security-Policy: frame-ancestors`, limitado a los dominios de GHL, incluido `app.iaorbita.com`. Para otro dominio, agrégalo en `PANEL_FRAME_ANCESTORS` en Vercel (lista separada por comas).

## 8. Panel: estados y reglas

| Pestaña | Estado | Acciones |
|---|---|---|
| Nuevos | `pending` | Imprimir. Al confirmar la impresión pasa a *En preparación* |
| En preparación | `printed` | Reimprimir, Despachar |
| Despachados | `dispatched` | Consulta, Cotizar |
| Productos y precios | catálogo | Buscar, filtrar, poner precios, añadir productos |
| Requiere ayuda | `help_requests` abiertas | Abrir conversación, Marcar resuelta |

- Despachar exige una impresión confirmada.
- Un **ajuste** conserva el número de pedido. Si el pedido ya estaba impreso, vuelve a *Nuevos* marcado **Ajuste · reimprimir** y no puede despacharse sin reimprimir.
- **Pedido manual** (llamadas): busca primero al cliente por nombre o teléfono y precarga nombre, teléfono, cédula y dirección desde GHL. El pedido se pega completo en un solo campo de texto; no se crean productos uno por uno. Si se seleccionó un contacto, también puede recibir la cotización por WhatsApp.
- Si un domicilio no tiene dirección, la tarjeta, el detalle y la comanda lo marcan claramente; el cuadro de despacho exige contactar al cliente antes de confirmar.
- La cuenta de domiciliario solo puede ver pedidos *En preparación*, abrir el detalle y despacharlos; las APIs bloquean creación, edición, eliminación, impresión, catálogo, cotizaciones y solicitudes de ayuda.
- **Sonido:** botón de la campana. Hace falta un clic porque el navegador bloquea el audio hasta entonces. Suena distinto para un pedido nuevo y para una solicitud de ayuda. El título de la pestaña muestra `(N) Ayuda`.

### Catálogo de productos

Los 12.305 productos de Frutitodo (carnes, frutas y verduras, víveres) vienen de sus hojas `KB_*.xlsx`, convertidas a `data/catalogo-frutitodo.csv` (carpeta ignorada por git). La unidad de venta sale de la nota de cada producto ("se vende por libra" → `lb`, "en bandeja" → `bandeja`); los víveres quedan en `und`. Se importa con:

```powershell
npm.cmd run import:products -- --location-id UfbKDvUAPCDEaRQWYXau --file data/catalogo-frutitodo.csv
```

Columnas reconocidas: `referencia;nombre;categoria;subcategoria;nota;unidad;precio`; solo `nombre` es obligatoria. Volver a importar actualiza nombres y notas sin duplicar, y **no borra precios** puestos desde el panel: una fila con `precio` vacío no toca el precio existente. Para cargar precios en bloque, llena la columna `precio` y vuelve a importar.

En la pestaña **Productos y precios** se busca por nombre o referencia (tolera tildes y errores de tipeo), se filtra por categoría y por "con / sin precio", se edita el precio y la unidad de cada producto (Enter o **Guardar**) y se añaden productos que no estén en las hojas.

## 9. Cotización

Desde la tarjeta (**Cotizar**) o el detalle del pedido:

1. El panel propone para cada línea el producto del catálogo que más se parece, con su precio. Si el cliente pidió en kg y el producto se vende por libra, convierte la cantidad (**1 lb = 500 g**) y lo indica. Una línea pedida por valor queda fija como ese valor y no se multiplica por el precio unitario del catálogo.
2. El operario confirma o cambia el producto (buscador), la cantidad, la unidad y el precio; puede agregar o quitar líneas y poner el valor del domicilio.
3. El total se calcula en vivo y **se recalcula en el servidor** (el navegador nunca decide el total).
4. **Guardar** deja la cotización como borrador; **Enviar al cliente** la manda por WhatsApp con la API de GHL, detallada línea por línea con subtotal, domicilio, total, método de pago y una nota opcional. El mensaje se puede ver antes de enviar.
5. "Guardar estos precios en el catálogo" (activado por defecto) actualiza el precio de los productos usados, así la siguiente cotización ya los trae.
6. La comanda impresa incluye la cotización con precios y total.

Reglas: no se envía si hay líneas sin precio; un doble clic o un reintento no manda el mensaje dos veces; si GHL rechaza el envío (por ejemplo, la ventana de 24 h de WhatsApp cerrada), el panel muestra el motivo y el borrador queda guardado.

Requiere en Vercel:

| Variable | Contenido |
|---|---|
| `GHL_API_TOKEN` | Private Integration token de la subcuenta (`conversations/message.write`, `contacts.write`, `contacts.readonly`) |
| `GHL_MESSAGE_TYPE` | Opcional, `WhatsApp` por defecto |
| `GHL_CF_DIRECCION` | Opcional, clave o ID de `direccion_de_envio` para precargar clientes |
| `GHL_CF_CEDULA` | Opcional, clave o ID de `documento_de_identidad` para precargar clientes |

## 10. Endpoints de la app

Todos los webhooks usan `Authorization: Bearer <GHL_INGEST_SECRET>`.

| Endpoint | Uso |
|---|---|
| `POST /api/webhooks/ghl/orders/upsert` | Consulta Supabase y decide si actualiza el pedido vigente (`pending`/`printed`) o crea uno nuevo |
| `POST /api/webhooks/ghl/orders` | Pedido nuevo (n8n) |
| `POST /api/webhooks/ghl/orders/amendments` | Ajuste al pedido abierto del contacto |
| `POST /api/webhooks/ghl/help-requests` | La IA pidió ayuda |

Cuerpo de pedido y ajuste:

```json
{
  "sourceEventId": "<sha256 del contacto + resumen>",
  "locationId": "UfbKDvUAPCDEaRQWYXau",
  "contactId": "<contacto>",
  "conversationId": "<opcional>",
  "customer": { "name": "…", "phone": "…", "document": "<opcional>" },
  "delivery": { "type": "domicilio", "address": "<opcional>" },
  "paymentMethod": "<opcional>",
  "items": [{ "name": "Pechuga de pollo troceada", "quantity": 2, "unit": "kg" }],
  "rawOrderText": "2 kg de pechuga troceada\n5 mil de papa",
  "notes": "<opcional>"
}
```

Respuestas del endpoint de ajustes:

| Código | Cuerpo | n8n |
|---|---|---|
| `200` | `amended: true`, mismo `order.number` | Listo |
| `200` | `duplicate: true` | Reintento; no hace nada |
| `404` | `no_open_order` | Lo crea como pedido nuevo |
| `409` | `already_dispatched` | Lo crea como pedido nuevo |

## 11. Pruebas manuales sugeridas

1. **Pedido nuevo:** enviar una lista completa → el agente ejecuta la tool sin preguntar cédula, dirección ni pago → aparece en *Nuevos* con "Abrir conversación". En GHL quedan `pedido_resumen`, `ultimo_pedido_numero` y `ultimo_pedido_estado = nuevo`.
2. **Ajuste antes de imprimir:** pedir un cambio → mismo número, marca "Ajustado por el cliente".
3. **Ajuste después de imprimir:** imprimir → el pedido pasa a *En preparación* y en GHL queda `en_preparacion`. Pedir un cambio → vuelve a *Nuevos* con **Ajuste · reimprimir**, mismo número, y el tiquete trae la leyenda de ajuste.
4. **Ajuste después de despachar:** se crea un pedido nuevo con otro número.
5. **Ayuda:** agregar la etiqueta `requiere_ayuda` a un contacto → tarjeta roja, sonido, título `(1) Ayuda`. "Abrir conversación" lleva al chat. Marcar resuelta.
6. **Mensaje sin pedido:** enviar una consulta sin productos → no se crea pedido y n8n responde `200 ignored`.
7. **Cotización:** "Cotizar" → revisar las sugerencias del catálogo → poner precios → "Enviar al cliente" → llega el WhatsApp detallado; la tarjeta muestra "Cotización enviada" y la comanda sale con precios. Volver a abrir el catálogo: los precios usados quedaron guardados.
7b. **Catálogo:** importar el CSV, buscar "pechuga", filtrar "Sin precio", poner un precio y guardarlo.
8. **Despachar:** llega el mensaje de "va en camino" y queda `despachado` en GHL.
9. **Pedido manual:** crear uno → aparece en *Nuevos* con la marca "Manual" → imprimir → despachar.
10. **Operador:** verificar si `{{user.name}}` llega por el menú. Si no, usar "¿Quién está de turno?" e imprimir para ver "Impreso por".
