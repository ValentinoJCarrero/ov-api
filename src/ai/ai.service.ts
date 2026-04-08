import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { ParsedIntent, Intent } from './types/intent.types';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 8000,
    });
  }

  /**
   * Parses the raw WhatsApp message text into a structured intent + entities object.
   * The AI never executes business logic — it only classifies and extracts data.
   *
   * @param staffNames - Active staff member names (for client prompts to extract staffName)
   * @param isOvapyMember - True when the sender is a MEMBER writing to Ovapy (not owner, not client)
   */
  async parseIntent(
    message: string,
    isAdmin: boolean,
    availableServices: string[],
    staffNames: string[] = [],
    isOvapyMember = false,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  ): Promise<ParsedIntent> {
    const systemPrompt = this.buildSystemPrompt(isAdmin, availableServices, staffNames, isOvapyMember);

    try {
      const response = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          ...conversationHistory,
          { role: 'user', content: message },
        ],
        temperature: 0,
        max_tokens: 256,
      });

      const raw = response.choices[0].message.content;
      const parsed = JSON.parse(raw);

      // Support both single-intent {"intent":"X"} and multi-intent {"intents":["X","Y"]}
      const intents: Intent[] = parsed.intents
        ? (parsed.intents as Intent[])
        : parsed.intent
          ? [parsed.intent as Intent]
          : ['UNKNOWN'];

      return {
        intent: intents[0],
        intents: intents.length > 1 ? intents : undefined,
        entities: parsed.entities ?? {},
      };
    } catch (err) {
      this.logger.error('AI intent parsing failed', err?.message);
      return { intent: 'UNKNOWN', entities: {} };
    }
  }

  private buildSystemPrompt(
    isAdmin: boolean,
    services: string[],
    staffNames: string[],
    isOvapyMember: boolean,
  ): string {
    const serviceList = services.join(', ') || 'no configurados';
    const today = new Date().toISOString().split('T')[0];

    // Ovapy MEMBER flow (staff checking their own schedule)
    if (isAdmin && isOvapyMember) {
      return `Sos un parser de intenciones para un profesional que consulta su agenda por WhatsApp.
Hoy es ${today}.

Respondé SOLO con JSON válido:
{ "intent": "<INTENT>", "entities": { ... } }

Intenciones:
- MY_APPOINTMENTS: quiere ver sus propios turnos de hoy (o de una fecha). Entidades: { "date": "YYYY-MM-DD" (opcional) }
  Ejemplos: "mis turnos de hoy", "¿qué tengo hoy?", "mi agenda"
- UNKNOWN: no reconocible.

Si no coincide con nada: { "intent": "UNKNOWN", "entities": {} }`;
    }

    // Ovapy OWNER flow
    if (isAdmin) {
      return `Sos un parser de intenciones para el dueño de un negocio que lo gestiona por WhatsApp.
Hoy es ${today}.
Servicios disponibles: ${serviceList}

Respondé SOLO con JSON válido:
{ "intent": "<INTENT>", "entities": { ... } }

Intenciones admin:
- REGISTER_SALE: registra una venta/ingreso. Entidades: { "description": string, "amount": number }
  Ejemplos: "Registra un corte x 10000", "anota barba por 7000", "sumá tintura por 25000"
- LIST_APPOINTMENTS: ver turnos del negocio. Entidades: { "date": "YYYY-MM-DD" (opcional, default hoy) }
  Ejemplos: "¿qué turnos hay hoy?", "mostrame los turnos de mañana"
- LIST_SALES: ver ventas/ingresos. Entidades: { "date": "YYYY-MM-DD" (opcional, default hoy) }
  Ejemplos: "¿cuánto vendí hoy?", "ventas de ayer"
- UNKNOWN: no reconocible.

Reglas:
- amount: número sin símbolos de moneda. "x", "por", "de" antes de un número = amount.
- Si menciona monto → REGISTER_SALE como fallback.
- Si no coincide con nada: { "intent": "UNKNOWN", "entities": {} }`;
    }

    // Client flow (customer booking)
    const staffStr = staffNames.length > 0 ? `Profesionales disponibles: ${staffNames.join(', ')}` : '';

    return `Sos un parser de intenciones para un sistema de turnos por WhatsApp.
Hoy es ${today}.
Servicios disponibles: ${serviceList}
${staffStr}

Respondé SOLO con JSON válido. Si el mensaje tiene UNA sola intención:
{ "intent": "<INTENT>", "entities": { ... } }

Si el mensaje tiene MÁS DE UNA intención (ej: pregunta servicios Y ubicación):
{ "intents": ["<INTENT1>", "<INTENT2>"], "entities": { ... } }

Intenciones:
- GREET: saludo. Entidades: {}
- CHECK_SERVICES: pregunta por servicios o precios. Entidades: {}
- CHECK_AVAILABILITY: pregunta disponibilidad. Entidades: { "service"? string, "date"? "YYYY-MM-DD", "staffName"? string }
- BOOK_APPOINTMENT: quiere reservar. Entidades: { "service"?: string, "services"?: string[], "date"?: "YYYY-MM-DD", "time"?: "HH:MM", "staffName"?: string }
  Si menciona UN servicio: usar "service". Si menciona MÁS DE UNO: usar "services" (array), omitir "service".
- RESCHEDULE_APPOINTMENT: quiere cambiar turno. Entidades: { "date": "YYYY-MM-DD", "time": "HH:MM" }
- CANCEL_APPOINTMENT: quiere cancelar. Entidades: {}
- GENERAL_QUESTION: pregunta sobre el negocio (dirección, ubicación, cómo llegar, horarios, zona, contacto, cualquier info general). Entidades: {}
- UNKNOWN: no determinable. Entidades: {}

Reglas:
- service/services: aproximar a nombres de: ${serviceList}
- Si el cliente pide un solo servicio → "service": "Corte". Si pide varios → "services": ["Corte", "Color"].
${staffNames.length > 0 ? `- staffName: si el cliente menciona un profesional, extraerlo. Nombres válidos: ${staffNames.join(', ')}` : ''}
- fecha: siempre YYYY-MM-DD. "mañana" = ${this.getTomorrow()}, "hoy" = ${today}
- hora: siempre HH:MM (24h)
- Resolvé fechas relativas ("el lunes próximo") desde hoy (${today})
- Si faltan entidades para BOOK_APPOINTMENT, devolvé igual la intención con lo que tengas
- Si el mensaje combina preguntas de distinto tipo (ej: precios + ubicación), usá "intents" array`;
  }

  /**
   * Parses a message from a staff member writing to the business number.
   * They can check their agenda, book for a client, or reschedule/cancel their appointments.
   */
  async parseStaffIntent(
    message: string,
    availableServices: string[],
  ): Promise<ParsedIntent> {
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = this.getTomorrow();
    const serviceList = availableServices.join(', ') || 'no configurados';

    const systemPrompt = `Sos un parser de intenciones para un profesional que gestiona su propia agenda por WhatsApp.
Hoy es ${today}.
Servicios disponibles: ${serviceList}

Respondé SOLO con JSON válido:
{ "intent": "<INTENT>", "entities": { ... } }

Intenciones:
- MY_APPOINTMENTS: quiere ver su propia agenda. Entidades: { "date"?: "YYYY-MM-DD" (default hoy) }
  Ejemplos: "mis turnos de hoy", "¿qué tengo?", "mi agenda del miércoles"

- BOOK_APPOINTMENT: quiere agendar un turno para un cliente. Entidades: { "service": string, "date": "YYYY-MM-DD", "time": "HH:MM", "clientName"?: string }
  Ejemplos: "agendá corte para Juan el martes a las 10", "anotá una barba mañana 14:00 para María"

- RESCHEDULE_APPOINTMENT: quiere mover un turno existente. Entidades: { "currentTime": "HH:MM", "date"?: "YYYY-MM-DD", "time": "HH:MM" }
  "currentTime" = horario del turno actual. "date"/"time" = nuevo horario.
  Ejemplos: "mover el de las 10 para las 15", "cambiá el turno de las 9 para mañana a las 11"

- CANCEL_APPOINTMENT: quiere cancelar un turno. Entidades: { "currentTime"?: "HH:MM", "date"?: "YYYY-MM-DD" }
  Si no especifica horario, cancela el próximo.
  Ejemplos: "cancelar el turno de las 14", "borrá el de las 10 de mañana"

- UNKNOWN: no reconocible.

Reglas:
- service: aproximar a uno de: ${serviceList}
- fecha: siempre YYYY-MM-DD. "mañana" = ${tomorrow}, "hoy" = ${today}
- hora: siempre HH:MM (24h)
- Si no coincide con nada: { "intent": "UNKNOWN", "entities": {} }`;

    try {
      const response = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        temperature: 0,
        max_tokens: 256,
      });

      const raw = response.choices[0].message.content;
      const parsed = JSON.parse(raw);

      if (!parsed.intent) return { intent: 'UNKNOWN', entities: {} };
      return { intent: parsed.intent as Intent, entities: parsed.entities ?? {} };
    } catch (err) {
      this.logger.error('Staff intent parsing failed', err?.message);
      return { intent: 'UNKNOWN', entities: {} };
    }
  }

  /**
   * Generates a natural free-form answer to a general business question
   * using the provided business context (address, hours, extra info, etc.)
   */
  async answerGeneralQuestion(userMessage: string, businessContext: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Sos el asistente de WhatsApp de un negocio. Respondé la pregunta del cliente usando SOLO la información del negocio que se te da. Sé conciso, amigable y en español. Si la info no está disponible, decilo brevemente.\n\nInformación del negocio:\n${businessContext}`,
          },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 200,
      });
      return response.choices[0].message.content?.trim() ?? '';
    } catch (err) {
      this.logger.error('answerGeneralQuestion failed', err?.message);
      throw err;
    }
  }

  private getTomorrow(): string {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }
}
