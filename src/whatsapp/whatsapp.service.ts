import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { WhatsappWebhookPayload } from './dto/whatsapp-webhook.dto';
import { BusinessService } from '../business/business.service';
import { ContactsService } from '../contacts/contacts.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ServicesService } from '../services/services.service';
import { StaffService } from '../staff/staff.service';
import { AiService } from '../ai/ai.service';
import { ActionDispatcherService } from './action-dispatcher.service';
import { OvapyDispatcherService } from './ovapy-dispatcher.service';
import { StaffSelfServiceDispatcherService } from './staff-self-service-dispatcher.service';
import { AppointmentsService } from '../appointments/appointments.service';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly businessService: BusinessService,
    private readonly contactsService: ContactsService,
    private readonly conversationsService: ConversationsService,
    private readonly servicesService: ServicesService,
    private readonly staffService: StaffService,
    private readonly aiService: AiService,
    private readonly actionDispatcher: ActionDispatcherService,
    private readonly ovapyDispatcher: OvapyDispatcherService,
    private readonly staffSelfServiceDispatcher: StaffSelfServiceDispatcherService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  /**
   * Main entry point for all inbound WhatsApp webhook events.
   * Routes to either the Ovapy internal flow or the client-facing flow
   * based on which phone number received the message.
   */
  async processInbound(payload: WhatsappWebhookPayload): Promise<void> {
    try {
      const entry = payload.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      if (!value?.messages?.length) {
        // Status updates (delivered, read) arrive here — ignore silently
        return;
      }

      const message = value.messages[0];
      const receivingPhoneNumberId = value.metadata?.phone_number_id;
      const senderPhone = message.from;

      // Handle Quick Reply button responses (from reminder templates)
      if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
        await this.processButtonReply(
          senderPhone,
          message.interactive.button_reply.id,
          receivingPhoneNumberId,
        );
        return;
      }

      if (message.type !== 'text' || !message.text?.body) {
        await this.sendMessage(senderPhone, 'Solo puedo procesar mensajes de texto por ahora.', receivingPhoneNumberId);
        return;
      }

      const messageText = message.text.body.trim();
      const senderName = value.contacts?.[0]?.profile?.name;

      this.logger.log(`Inbound [${receivingPhoneNumberId}] [${senderPhone}]: "${messageText}"`);

      // Route based on which number received the message
      const ovapyPhoneNumberId = process.env.OVAPY_PHONE_NUMBER_ID;

      if (ovapyPhoneNumberId && receivingPhoneNumberId === ovapyPhoneNumberId) {
        await this.processOvapyMessage(senderPhone, messageText);
      } else {
        await this.processClientMessage(senderPhone, messageText, senderName, receivingPhoneNumberId, message.id);
      }
    } catch (err) {
      this.logger.error('Error processing inbound message', err?.message, err?.stack);
    }
  }

  /**
   * Ovapy flow: messages sent to the Ovapy management number.
   * Identifies sender as owner or staff member by their registered phone.
   */
  private async processOvapyMessage(senderPhone: string, messageText: string): Promise<void> {
    const staffMember = await this.staffService.findByPhoneAcrossBusinesses(senderPhone);

    if (!staffMember) {
      await this.sendOvapyMessage(
        senderPhone,
        'No tenés una cuenta en el sistema. Contactate con soporte para registrarte.',
      );
      return;
    }

    const business = await this.businessService.findById(staffMember.businessId);
    if (!business) {
      await this.sendOvapyMessage(senderPhone, 'Error al cargar el negocio. Contactate con soporte.');
      return;
    }

    // Solo el OWNER interactúa por Ovapy; el staff usa el número del negocio
    if (staffMember.role !== 'OWNER') {
      this.logger.log(`Ovapy: ignoring message from MEMBER ${senderPhone} (${staffMember.id})`);
      return;
    }

    const serviceNames = await this.servicesService.getServiceNames(business.id);

    const parsed = await this.aiService.parseIntent(messageText, true, serviceNames, []);

    this.logger.log(`Ovapy intent [${senderPhone}] (OWNER): ${parsed.intent}`);

    const responseText = await this.ovapyDispatcher.dispatch({
      intent: parsed.intent,
      entities: parsed.entities,
      staffMember,
      business,
      isOwner: true,
    });

    await this.sendOvapyMessage(senderPhone, responseText);
  }

  /**
   * Client flow: messages sent to the business's WhatsApp number.
   * Handles appointment booking with multi-staff support.
   */
  private async processClientMessage(
    senderPhone: string,
    messageText: string,
    senderName: string | undefined,
    receivingPhoneNumberId: string,
    messageId?: string,
  ): Promise<void> {
    // Find the business by its configured WA phone number ID, fallback to default
    let business = await this.businessService.findByWaPhoneNumberId(receivingPhoneNumberId);
    if (!business) {
      business = await this.businessService.getDefaultBusiness();
    }

    // Mark message as read (blue ticks) + show typing indicator — best-effort, non-blocking
    const msgToken = business.waToken ?? process.env.WHATSAPP_TOKEN;
    const msgPid = business.waPhoneNumberId ?? receivingPhoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (messageId) this.markAsRead(messageId, msgPid, msgToken).catch(() => {});
    this.sendTypingIndicator(senderPhone, msgPid, msgToken).catch(() => {});

    // Detect if the sender is a staff member of this business
    const staffMember = await this.staffService.findByPhoneInBusiness(business.id, senderPhone);
    if (staffMember) {
      await this.processStaffSelfServiceMessage(senderPhone, messageText, staffMember, business);
      return;
    }

    const contact = await this.contactsService.findOrCreate(business.id, senderPhone, senderName);
    const conversation = await this.conversationsService.findOrCreateOpen(business.id, contact.id);

    // Save inbound message
    await this.conversationsService.saveMessage({
      conversationId: conversation.id,
      businessId: business.id,
      contactId: contact.id,
      direction: 'INBOUND',
      type: 'TEXT',
      content: messageText,
      rawPayload: { phone: senderPhone, text: messageText },
    });

    // Human mode: skip AI and auto-reply — owner handles this conversation manually from the inbox
    if (conversation.humanMode) {
      this.logger.log(`Human mode active for conversation ${conversation.id} — skipping AI`);
      return;
    }

    const serviceNames = await this.servicesService.getServiceNames(business.id);
    const staffNames = await this.staffService.getActiveNames(business.id);

    // Check conversation state for multi-turn flows
    const convState = await this.conversationsService.getState(conversation.id);

    // Fetch up to 3 prior messages for AI context (current message already saved, so skip it)
    const recentMsgs = await this.conversationsService.getRecentMessages(conversation.id, 4);
    const priorMsgs = recentMsgs.slice(1).reverse(); // exclude current, oldest-first
    const conversationHistory = priorMsgs.map((m) => ({
      role: (m.direction === 'INBOUND' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    }));

    const parsed = await this.aiService.parseIntent(
      messageText,
      false,
      serviceNames,
      staffNames,
      false,
      conversationHistory,
    );

    this.logger.log(`Client intent [${senderPhone}]: ${parsed.intent} | entities: ${JSON.stringify(parsed.entities)}`);

    const responseText = await this.actionDispatcher.dispatch({
      intent: parsed.intent,
      intents: parsed.intents,
      entities: parsed.entities,
      contact,
      business,
      isAdmin: false,
      conversationId: conversation.id,
      conversationState: convState,
      rawMessage: messageText,
    });

    // Sending credentials: DB-configured per business (set via admin panel)
    // Falls back to env WHATSAPP_TOKEN only if the business hasn't configured its own token yet
    const token = business.waToken ?? process.env.WHATSAPP_TOKEN;
    const phoneNumberId = business.waPhoneNumberId ?? undefined;

    await this.sendMessage(senderPhone, responseText, phoneNumberId, token);

    await this.conversationsService.saveMessage({
      conversationId: conversation.id,
      businessId: business.id,
      contactId: contact.id,
      direction: 'OUTBOUND',
      type: 'TEXT',
      content: responseText,
    });
  }

  /**
   * Sends a text message via WhatsApp Cloud API.
   * Uses provided credentials or falls back to env vars.
   * Never throws — logs errors and continues.
   */
  async sendMessage(
    to: string,
    text: string,
    phoneNumberId?: string,
    token?: string,
  ): Promise<void> {
    const pid = phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
    const tok = token ?? process.env.WHATSAPP_TOKEN;

    if (!pid || !tok) {
      this.logger.warn('WhatsApp credentials not configured. Skipping send.');
      this.logger.log(`[MOCK SEND to ${to}]: ${text}`);
      return;
    }

    try {
      await axios.post(
        `https://graph.facebook.com/v19.0/${pid}/messages`,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        },
        {
          headers: {
            Authorization: `Bearer ${tok}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        },
      );

      this.logger.log(`Sent to ${to}: "${text.substring(0, 60)}..."`);
    } catch (err) {
      this.logger.error(
        `Failed to send WA message to ${to}: ${err?.response?.data?.error?.message ?? err?.message}`,
      );
    }
  }

  /**
   * Handles Quick Reply button taps from reminder templates.
   * Payload format: "confirm_{appointmentId}" or "cancel_{appointmentId}"
   */
  private async processButtonReply(
    senderPhone: string,
    payloadId: string,
    receivingPhoneNumberId: string,
  ): Promise<void> {
    this.logger.log(`Button reply from ${senderPhone}: "${payloadId}"`);

    const [action, appointmentId] = payloadId.split('_', 2);
    if (!action || !appointmentId) {
      this.logger.warn(`Unrecognized button payload: ${payloadId}`);
      return;
    }

    const appointment = await this.appointmentsService.findById(appointmentId);
    if (!appointment) {
      this.logger.warn(`Button reply for unknown appointment ${appointmentId}`);
      return;
    }

    let business = await this.businessService.findByWaPhoneNumberId(receivingPhoneNumberId);
    if (!business) business = await this.businessService.getDefaultBusiness();

    const token = business.waToken ?? process.env.WHATSAPP_TOKEN;
    const phoneNumberId = business.waPhoneNumberId ?? undefined;

    if (action === 'confirm') {
      await this.appointmentsService.updateStatus(appointmentId, 'CONFIRMED');
      await this.sendMessage(
        senderPhone,
        '✅ ¡Turno confirmado! Te esperamos. Si necesitás cambiar algo, escribinos.',
        phoneNumberId,
        token,
      );
      this.logger.log(`Appointment ${appointmentId} confirmed by client`);
    } else if (action === 'cancel') {
      await this.appointmentsService.updateStatus(appointmentId, 'CANCELLED');
      await this.sendMessage(
        senderPhone,
        '❌ Turno cancelado. Si querés reservar otro horario, escribí "quiero turno" y te ayudo.',
        phoneNumberId,
        token,
      );
      this.logger.log(`Appointment ${appointmentId} cancelled by client`);
    } else {
      this.logger.warn(`Unknown button action: ${action}`);
    }
  }

  /**
   * Sends an approved WhatsApp template message with Quick Reply buttons.
   * Used for appointment reminders (business-initiated, outside 24h window).
   *
   * The template must be pre-approved in Meta Business Manager.
   * Expected template body parameters: {{1}}=clientName, {{2}}=service, {{3}}=date, {{4}}=time
   * Expected buttons: index 0 = Confirmar (payload: confirm_{id}), index 1 = Cancelar (payload: cancel_{id})
   */
  async sendTemplateMessage(params: {
    to: string;
    templateName: string;
    languageCode?: string;
    bodyParams: string[];      // ordered list of {{1}}, {{2}}... substitutions
    buttonPayloads: string[];  // one payload string per Quick Reply button, in order
    phoneNumberId?: string;
    token?: string;
  }): Promise<void> {
    const { to, templateName, languageCode = 'es_AR', bodyParams, buttonPayloads, phoneNumberId, token } = params;
    const pid = phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
    const tok = token ?? process.env.WHATSAPP_TOKEN;

    if (!pid || !tok) {
      this.logger.warn(`Template send skipped — WA credentials not configured. Mock: [${templateName}] to ${to}`);
      return;
    }

    const components: any[] = [
      {
        type: 'body',
        parameters: bodyParams.map((text) => ({ type: 'text', text })),
      },
      ...buttonPayloads.map((payload, index) => ({
        type: 'button',
        sub_type: 'quick_reply',
        index: String(index),
        parameters: [{ type: 'payload', payload }],
      })),
    ];

    try {
      await axios.post(
        `https://graph.facebook.com/v19.0/${pid}/messages`,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: languageCode },
            components,
          },
        },
        {
          headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
          timeout: 10000,
        },
      );
      this.logger.log(`Template "${templateName}" sent to ${to}`);
    } catch (err) {
      this.logger.error(
        `Failed to send template "${templateName}" to ${to}: ${err?.response?.data?.error?.message ?? err?.message}`,
      );
    }
  }

  /**
   * Staff self-service flow: a registered staff member writes to the business's own WA number.
   * They get a different menu: view their own agenda, book for a client, reschedule, cancel.
   */
  private async processStaffSelfServiceMessage(
    senderPhone: string,
    messageText: string,
    staffMember: any,
    business: any,
  ): Promise<void> {
    const serviceNames = await this.servicesService.getServiceNames(business.id);
    const parsed = await this.aiService.parseStaffIntent(messageText, serviceNames);

    this.logger.log(`Staff self-service [${senderPhone}] (${staffMember.name}): ${parsed.intent} | ${JSON.stringify(parsed.entities)}`);

    const responseText = await this.staffSelfServiceDispatcher.dispatch({
      intent: parsed.intent,
      entities: parsed.entities,
      staffMember,
      business,
    });

    const token = business.waToken ?? process.env.WHATSAPP_TOKEN;
    const phoneNumberId = business.waPhoneNumberId ?? undefined;
    await this.sendMessage(senderPhone, responseText, phoneNumberId, token);
  }

  /**
   * Marks an incoming message as read — shows blue double-tick to the sender.
   */
  async markAsRead(messageId: string, phoneNumberId?: string, token?: string): Promise<void> {
    const pid = phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
    const tok = token ?? process.env.WHATSAPP_TOKEN;
    if (!pid || !tok) return;
    await axios.post(
      `https://graph.facebook.com/v19.0/${pid}/messages`,
      { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
      { headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, timeout: 5000 },
    );
  }

  /**
   * Shows the "typing…" indicator to the recipient before the bot replies.
   * Supported in WhatsApp Cloud API v19+ via the messages endpoint.
   * Silently ignored if the account/tier doesn't support it.
   */
  async sendTypingIndicator(to: string, phoneNumberId?: string, token?: string): Promise<void> {
    const pid = phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
    const tok = token ?? process.env.WHATSAPP_TOKEN;
    if (!pid || !tok) return;
    await axios.post(
      `https://graph.facebook.com/v19.0/${pid}/messages`,
      { messaging_product: 'whatsapp', to, type: 'typing' },
      { headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, timeout: 5000 },
    );
  }

  /**
   * Sends a message from the Ovapy number (internal management channel).
   */
  private async sendOvapyMessage(to: string, text: string): Promise<void> {
    await this.sendMessage(
      to,
      text,
      process.env.OVAPY_PHONE_NUMBER_ID,
      process.env.WHATSAPP_TOKEN, // Ovapy always uses the platform token
    );
  }
}
