// TypeScript interfaces mirroring the Meta WhatsApp Cloud API webhook payload structure.
// Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components

export interface WhatsappProfile {
  name: string;
}

export interface WhatsappContact {
  profile: WhatsappProfile;
  wa_id: string;
}

export interface WhatsappTextMessage {
  body: string;
}

export interface WhatsappButtonReply {
  id: string;    // payload we set in the template component (e.g. "confirm_clxxx")
  title: string; // button label shown to the user
}

export interface WhatsappInteractive {
  type: 'button_reply' | 'list_reply';
  button_reply?: WhatsappButtonReply;
}

export interface WhatsappMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string; // "text" | "interactive" | "image" | "audio" | etc.
  text?: WhatsappTextMessage;
  interactive?: WhatsappInteractive;
}

export interface WhatsappStatus {
  id: string;
  status: string; // "sent" | "delivered" | "read" | "failed"
  timestamp: string;
  recipient_id: string;
}

export interface WhatsappMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

export interface WhatsappChangeValue {
  messaging_product: string;
  metadata: WhatsappMetadata;
  contacts?: WhatsappContact[];
  messages?: WhatsappMessage[];
  statuses?: WhatsappStatus[];
}

export interface WhatsappChange {
  value: WhatsappChangeValue;
  field: string;
}

export interface WhatsappEntry {
  id: string;
  changes: WhatsappChange[];
}

export interface WhatsappWebhookPayload {
  object: string;
  entry: WhatsappEntry[];
}
