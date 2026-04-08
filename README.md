# WhatsApp Appointment Manager

Sistema MVP de gestión de turnos y ventas para negocios (barbería), conectado a WhatsApp Cloud API.

## Stack

- **NestJS** — framework backend
- **PostgreSQL** — base de datos
- **Prisma ORM** — acceso a datos y migraciones
- **WhatsApp Cloud API (Meta)** — canal de mensajería
- **OpenAI (gpt-4o-mini)** — parseo de intenciones
- **NestJS Schedule** — cron jobs para recordatorios

---

## Setup rápido

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Editar `.env`:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/whatsapp_appointments"
WHATSAPP_TOKEN="tu_token_de_meta"
WHATSAPP_PHONE_NUMBER_ID="tu_phone_number_id"
WHATSAPP_VERIFY_TOKEN="string_que_vos_elegis"
OPENAI_API_KEY="sk-..."
BUSINESS_ADMIN_PHONE="5491112345678"   # número del dueño SIN el +
PORT=3000
```

> **BUSINESS_ADMIN_PHONE**: el número de WhatsApp del dueño del negocio. Los mensajes que lleguen desde este número activan el flujo admin (registrar ventas, ver turnos, etc.).

### 3. Crear la base de datos y correr migraciones

```bash
# Crear la base de datos en PostgreSQL primero
createdb whatsapp_appointments

# Correr la migración inicial
npx prisma migrate dev --name init
```

### 4. Seed de datos iniciales (barbería demo)

```bash
npm run prisma:seed
```

Esto crea:
- Negocio: **Barbería Demo**
- Servicios: Corte ($10.000/30min), Barba ($7.000/20min), Corte+Barba ($15.000/50min)
- Horarios: Lun–Vie 10–20hs, Sáb 10–14hs, Dom cerrado

### 5. Iniciar el servidor

```bash
npm run start:dev
```

El servidor queda en `http://localhost:3000`.

---

## Configurar el Webhook de WhatsApp

Para recibir mensajes de WhatsApp necesitás exponer el puerto 3000 a internet. En desarrollo, usá **ngrok**:

```bash
ngrok http 3000
```

Luego en el dashboard de Meta (developers.facebook.com):
1. Ir a la app → WhatsApp → Configuración
2. En "Webhooks", agregar la URL: `https://TU-NGROK-URL/webhook`
3. Como "Verify Token" usar el valor de `WHATSAPP_VERIFY_TOKEN` en tu `.env`
4. Suscribirse al evento `messages`

Para verificar manualmente:
```
GET /webhook?hub.mode=subscribe&hub.verify_token=TU_TOKEN&hub.challenge=test
→ Responde "test" si está bien configurado
```

---

## Flujo de mensajes

### Cliente final

| Mensaje | Respuesta |
|---------|-----------|
| "hola" | Bienvenida + menú |
| "servicios" | Lista de servicios y precios |
| "¿tienen lugar mañana?" | Horarios disponibles |
| "quiero turno corte el lunes a las 10" | Confirmación de turno |
| "necesito cambiar mi turno al jueves a las 15" | Turno reagendado |
| "cancelo mi turno" | Cancelación confirmada |

### Dueño del negocio (número admin)

| Mensaje | Acción |
|---------|--------|
| "registra un corte x 10000" | Venta registrada en DB |
| "anota barba por 7000" | Venta registrada |
| "¿qué turnos tengo hoy?" | Lista de turnos del día |
| "¿cuánto vendí hoy?" | Resumen de ventas del día |

---

## API Admin (REST)

Endpoints disponibles en `http://localhost:3000/admin/`:

### Turnos

```
GET    /admin/appointments              # listar (filtros: ?date=YYYY-MM-DD&status=CONFIRMED)
POST   /admin/appointments              # crear manual
PATCH  /admin/appointments/:id/status  # cambiar estado
GET    /admin/appointments/availability # ver disponibilidad (?date=YYYY-MM-DD&serviceId=...)
```

### Ventas

```
GET  /admin/sales     # listar (filtro: ?date=YYYY-MM-DD)
POST /admin/sales     # registrar manual
```

### Servicios

```
GET   /admin/services     # listar
POST  /admin/services     # crear
PATCH /admin/services/:id # actualizar
```

### Contactos

```
GET /admin/contacts   # listar
```

---

## Ejemplos de payloads

### Registrar venta (POST /admin/sales)

```json
{
  "description": "Corte de pelo",
  "amount": 10000,
  "source": "MANUAL"
}
```

### Crear turno manual (POST /admin/appointments)

```json
{
  "contactId": "cuid_del_contacto",
  "serviceId": "seed-corte",
  "startsAt": "2026-04-01T13:00:00.000Z",
  "source": "MANUAL"
}
```

### Crear servicio (POST /admin/services)

```json
{
  "name": "Teñido",
  "durationMinutes": 60,
  "price": 25000
}
```

---

## Recordatorios automáticos

El cron job corre **cada hora** (al minuto 0) y:

1. Busca turnos con `status IN (PENDING, CONFIRMED)` que:
   - Ocurran en las próximas 24 horas
   - No tengan `reminderSentAt` (para evitar duplicados)
2. Envía un mensaje de WhatsApp al cliente
3. Actualiza `reminderSentAt` + crea un `ReminderLog`

Si el envío falla, registra el error en `ReminderLog` pero continúa con los demás.

---

## Arquitectura

```
POST /webhook
  └─► WhatsappService.processInbound()
        ├─ BusinessService.getDefaultBusiness()
        ├─ BusinessService.isAdminPhone()        → determina flujo admin/cliente
        ├─ ContactsService.findOrCreate()
        ├─ ConversationsService.findOrCreateOpen()
        ├─ ConversationsService.saveMessage(INBOUND)
        ├─ AiService.parseIntent()               → { intent, entities }
        ├─ ActionDispatcherService.dispatch()    → string de respuesta
        │     ├─ AppointmentsService (disponibilidad, reservar, cancelar)
        │     ├─ ServicesService (listar servicios)
        │     └─ SalesService (registrar venta)
        ├─ WhatsappService.sendMessage()
        └─ ConversationsService.saveMessage(OUTBOUND)
```

### Módulos NestJS

| Módulo | Responsabilidad |
|--------|----------------|
| `whatsapp` | Webhook, envío de mensajes, orquestación del flujo |
| `ai` | Parseo de intenciones vía OpenAI |
| `business` | Carga del negocio, detección de admin |
| `contacts` | Gestión de contactos (findOrCreate) |
| `conversations` | Conversaciones y mensajes |
| `appointments` | Agenda, disponibilidad, booking |
| `services` | Catálogo de servicios del negocio |
| `sales` | Registro de ingresos/ventas |
| `reminders` | Cron de recordatorios automáticos |

---

## Notas de diseño

- **Single-tenant por ahora**: solo hay un `Business` en DB. Los módulos ya están preparados para multi-tenant (todas las queries incluyen `businessId`).
- **Timezones**: los datetimes se guardan en UTC en la DB. El timezone del negocio (`America/Argentina/Buenos_Aires`) se usa para mostrar y parsear fechas.
- **AI solo clasifica**: OpenAI devuelve un JSON con `intent + entities`. Toda la lógica de negocio (disponibilidad, booking, etc.) vive en los servicios NestJS.
- **Idempotencia de recordatorios**: el campo `reminderSentAt` en `Appointment` actúa como guard — si ya está seteado, el cron no vuelve a enviar.
- **Race conditions**: el booking usa `prisma.$transaction` para re-verificar disponibilidad antes de confirmar un turno.

---

## Comandos útiles

```bash
npm run start:dev        # desarrollo con hot reload
npm run build            # compilar
npm run prisma:studio    # abrir Prisma Studio (GUI de la DB)
npm run prisma:seed      # volver a correr el seed
npx prisma migrate dev   # crear nueva migración
```
