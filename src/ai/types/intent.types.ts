// Intents available to regular clients (appointment flow)
export type ClientIntent =
  | 'CHECK_AVAILABILITY'
  | 'BOOK_APPOINTMENT'
  | 'RESCHEDULE_APPOINTMENT'
  | 'CANCEL_APPOINTMENT'
  | 'CHECK_SERVICES'
  | 'GENERAL_QUESTION'
  | 'GREET'
  | 'UNKNOWN';

// Intents available via the Ovapy number (owner only)
export type AdminIntent =
  | 'REGISTER_SALE'
  | 'LIST_APPOINTMENTS'
  | 'LIST_SALES';

// Intents for staff writing to the business number (self-service)
export type StaffSelfIntent =
  | 'MY_APPOINTMENTS'          // ver su propia agenda hoy
  | 'BOOK_APPOINTMENT'         // agendar turno para un cliente
  | 'RESCHEDULE_APPOINTMENT'   // mover un turno de su agenda
  | 'CANCEL_APPOINTMENT'       // cancelar un turno de su agenda
  | 'UNKNOWN';

export type Intent = ClientIntent | AdminIntent | StaffSelfIntent;

export interface IntentEntities {
  // Appointment-related
  service?: string;   // single service name
  services?: string[]; // multiple services (when client requests more than one)
  date?: string;      // ISO "YYYY-MM-DD"
  time?: string;      // "HH:MM" 24h — new time (for booking or destination of reschedule)
  currentTime?: string; // "HH:MM" — identifies the EXISTING appointment to move/cancel
  staffName?: string;   // name of preferred staff member (client flow)
  branchName?: string;  // name of preferred branch/sucursal (client flow)
  clientName?: string;  // name of the client (staff self-service booking)

  // Sale-related
  description?: string;
  amount?: number;
}

export interface ParsedIntent {
  intent: Intent;
  intents?: Intent[];   // all intents when message contains multiple questions
  entities: IntentEntities;
}

// State stored in Conversation.state for multi-turn booking flows
export interface ConversationState {
  step: 'AWAITING_BRANCH_PREFERENCE' | 'AWAITING_STAFF_PREFERENCE' | 'AWAITING_BOOKING_DETAILS' | 'AWAITING_CANCEL_TO_REBOOK' | null;
  pendingIntent?: Intent;
  pendingEntities?: IntentEntities;
  pendingBranchId?: string | null;
  pendingStaffId?: string | null;
  selectedStaffId?: string | null;
  // Persisted after preferences are resolved — avoids re-asking on the next query (24h TTL)
  lastSelectedBranchId?: string | null;
  lastSelectedBranchIdAt?: string;
  lastSelectedStaffId?: string | null;
  lastSelectedStaffIdAt?: string;
  // Used in AWAITING_CANCEL_TO_REBOOK
  cancelTargetAppointmentId?: string;
}
