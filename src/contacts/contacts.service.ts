import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Contact } from '@prisma/client';

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds an existing contact by phone or creates a new one.
   * If the contact exists without a name and a name is now provided, updates it.
   */
  async findOrCreate(businessId: string, phone: string, name?: string): Promise<Contact> {
    const existing = await this.prisma.contact.findUnique({
      where: { businessId_phone: { businessId, phone } },
    });

    if (existing) {
      // Update name if we now have one and didn't before
      if (name && !existing.name) {
        return this.prisma.contact.update({
          where: { id: existing.id },
          data: { name },
        });
      }
      return existing;
    }

    this.logger.log(`New contact: ${phone} (${name ?? 'unknown'})`);
    return this.prisma.contact.create({
      data: { businessId, phone, name },
    });
  }

  async findByPhone(businessId: string, phone: string): Promise<Contact | null> {
    return this.prisma.contact.findUnique({
      where: { businessId_phone: { businessId, phone } },
    });
  }

  async findById(contactId: string): Promise<Contact | null> {
    return this.prisma.contact.findUnique({ where: { id: contactId } });
  }

  async updateNotes(contactId: string, notes: string): Promise<Contact> {
    return this.prisma.contact.update({
      where: { id: contactId },
      data: { notes },
    });
  }

  async listAll(businessId: string): Promise<Contact[]> {
    return this.prisma.contact.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Finds an existing contact by name (fuzzy) or creates a walk-in contact.
   * Used when staff books an appointment for a client they only know by name.
   * Walk-in contacts get a placeholder phone so they don't collide with real contacts.
   */
  async findOrCreateByName(businessId: string, clientName: string): Promise<Contact> {
    const all = await this.prisma.contact.findMany({ where: { businessId } });
    const normalized = clientName.toLowerCase().trim();

    const match =
      all.find((c) => c.name?.toLowerCase() === normalized) ??
      all.find((c) => c.name?.toLowerCase().startsWith(normalized)) ??
      all.find((c) => c.name?.toLowerCase().includes(normalized));

    if (match) return match;

    // Create a walk-in contact with a unique placeholder phone
    const placeholderPhone = `walkin-${Date.now()}`;
    this.logger.log(`Creating walk-in contact: ${clientName}`);
    return this.prisma.contact.create({
      data: { businessId, name: clientName, phone: placeholderPhone },
    });
  }
}
