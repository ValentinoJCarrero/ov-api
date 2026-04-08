import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...\n');

  // Business phone is just a contact reference — owner identity comes from Staff.role === OWNER
  const BUSINESS_SEED_PHONE = 'seed-barberiademo';

  // ─────────────────────────────────────────
  // 1. Business
  // ─────────────────────────────────────────
  const business = await prisma.business.upsert({
    where: { phoneNumber: BUSINESS_SEED_PHONE },
    update: {},
    create: {
      name: 'Barbería Demo',
      timezone: 'America/Argentina/Buenos_Aires',
      phoneNumber: BUSINESS_SEED_PHONE,
      // waToken, waPhoneNumberId, waVerifyToken → set from admin panel
    },
  });

  console.log(`✅ Business: ${business.name} (id: ${business.id})`);

  // ─────────────────────────────────────────
  // 2. Services
  // ─────────────────────────────────────────
  const servicesData = [
    { name: 'Corte', durationMinutes: 30, price: 10000 },
    { name: 'Barba', durationMinutes: 20, price: 7000 },
    { name: 'Corte + Barba', durationMinutes: 50, price: 15000 },
  ];

  for (const svc of servicesData) {
    const seedId = `seed-${svc.name.toLowerCase().replace(/\s+|\+/g, '-')}`;
    await prisma.service.upsert({
      where: { id: seedId },
      update: { price: svc.price, durationMinutes: svc.durationMinutes },
      create: {
        id: seedId,
        businessId: business.id,
        name: svc.name,
        durationMinutes: svc.durationMinutes,
        price: svc.price,
        isActive: true,
      },
    });
    console.log(`✅ Service: ${svc.name} (${svc.durationMinutes} min, $${svc.price})`);
  }

  // ─────────────────────────────────────────
  // 3. Business Hours (fallback — used if no staff configured)
  // ─────────────────────────────────────────
  const businessHoursData = [
    { dayOfWeek: 0, openTime: '00:00', closeTime: '00:00', isActive: false }, // Sun
    { dayOfWeek: 1, openTime: '10:00', closeTime: '20:00', isActive: true },
    { dayOfWeek: 2, openTime: '10:00', closeTime: '20:00', isActive: true },
    { dayOfWeek: 3, openTime: '10:00', closeTime: '20:00', isActive: true },
    { dayOfWeek: 4, openTime: '10:00', closeTime: '20:00', isActive: true },
    { dayOfWeek: 5, openTime: '10:00', closeTime: '20:00', isActive: true },
    { dayOfWeek: 6, openTime: '10:00', closeTime: '14:00', isActive: true },
  ];

  for (const hours of businessHoursData) {
    await prisma.businessHours.upsert({
      where: { businessId_dayOfWeek: { businessId: business.id, dayOfWeek: hours.dayOfWeek } },
      update: hours,
      create: { businessId: business.id, ...hours },
    });
  }
  console.log('✅ Business hours seeded (fallback)');

  // ─────────────────────────────────────────
  // 4. Staff (demo professionals)
  // ─────────────────────────────────────────
  const staffData = [
    {
      id: 'seed-staff-pedro',
      name: 'Pedro Ramírez',
      phone: '5491100000001',
      role: 'MEMBER' as const,
      hours: [
        { dayOfWeek: 1, openTime: '10:00', closeTime: '20:00' },
        { dayOfWeek: 2, openTime: '10:00', closeTime: '20:00' },
        { dayOfWeek: 3, openTime: '10:00', closeTime: '20:00' },
        { dayOfWeek: 4, openTime: '10:00', closeTime: '20:00' },
        { dayOfWeek: 5, openTime: '10:00', closeTime: '20:00' },
        { dayOfWeek: 6, openTime: '10:00', closeTime: '14:00' },
      ],
    },
    {
      id: 'seed-staff-juan',
      name: 'Juan López',
      phone: '5491100000002',
      role: 'MEMBER' as const,
      hours: [
        { dayOfWeek: 1, openTime: '12:00', closeTime: '20:00' },
        { dayOfWeek: 2, openTime: '12:00', closeTime: '20:00' },
        { dayOfWeek: 3, openTime: '12:00', closeTime: '20:00' },
        { dayOfWeek: 4, openTime: '12:00', closeTime: '20:00' },
        { dayOfWeek: 5, openTime: '12:00', closeTime: '20:00' },
        { dayOfWeek: 6, openTime: '10:00', closeTime: '14:00' },
      ],
    },
    {
      id: 'seed-staff-owner',
      name: 'Jerry (Dueño)',
      phone: '5491100000000', // placeholder — update from admin panel with real owner phone
      role: 'OWNER' as const,
      hours: [], // owner doesn't take client appointments
    },
  ];

  for (const member of staffData) {
    const { hours, ...staffFields } = member;
    await prisma.staff.upsert({
      where: { id: staffFields.id },
      update: { name: staffFields.name, phone: staffFields.phone },
      create: { ...staffFields, businessId: business.id, isActive: true },
    });

    // Seed per-staff hours
    for (const h of hours) {
      await prisma.staffHours.upsert({
        where: { staffId_dayOfWeek: { staffId: staffFields.id, dayOfWeek: h.dayOfWeek } },
        update: { openTime: h.openTime, closeTime: h.closeTime, isActive: true },
        create: {
          staffId: staffFields.id,
          businessId: business.id,
          dayOfWeek: h.dayOfWeek,
          openTime: h.openTime,
          closeTime: h.closeTime,
          isActive: true,
        },
      });
    }

    console.log(`✅ Staff: ${staffFields.name} (${staffFields.role}) — ${hours.length} day(s) configured`);
  }

  console.log('\n🎉 Seed complete!\n');
  console.log('Próximos pasos:');
  console.log('1. Abrí el panel admin → http://localhost:3000/admin');
  console.log('2. Configurá las credenciales WA del negocio (waToken, waPhoneNumberId)');
  console.log('3. Actualizá el teléfono del dueño (seed-staff-owner) con el número real');
  console.log('4. Pedro demo: 5491100000001 | Juan demo: 5491100000002');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
