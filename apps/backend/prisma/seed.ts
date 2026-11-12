import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const name = process.env.SEED_ADMIN_NAME ?? 'System Admin';
  const phoneNumber = process.env.SEED_ADMIN_PHONE ?? '+998900000000';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'admin12345';

  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.user.upsert({
    where: { phoneNumber },
    update: {},
    create: { name, phoneNumber, passwordHash, role: 'admin', status: 'active' },
  });

  console.log(`Seeded admin user: ${admin.name} (${admin.phoneNumber})`);

  // Cargo-type catalog for the seller board's "Asosiy ortiladigan yuk" dropdown.
  const cargoTypes = ['Suxoy smes qoplar', 'Sement', "G'isht", 'Metall', 'Yog', 'Boshqa'];
  for (const cargoName of cargoTypes) {
    await prisma.cargoType.upsert({
      where: { name: cargoName },
      update: {},
      create: { name: cargoName },
    });
  }
  console.log(`Seeded ${cargoTypes.length} cargo types`);

  // Placeholder stations and service centres are for development only: in
  // production the real list is entered in the dashboard. SEED_PLACEHOLDERS=true
  // forces them anyway.
  const placeholders = process.env.NODE_ENV !== 'production' || process.env.SEED_PLACEHOLDERS === 'true';

  // Contracted fuel stations — placeholder set around Tashkent until the real
  // list arrives. Coordinates are district centres, not real forecourts, so
  // the fence check will behave but will not match a real fill-up; replace
  // them, do not add to them.
  const fuelStations: {
    name: string; brand: string; address: string; lat: number; lng: number;
    fuelTypes: ('gaz' | 'benzin' | 'propan')[];
  }[] = [
    { name: 'Metan Servis — Yunusobod', brand: 'Metan Servis', address: "Yunusobod tumani, Amir Temur ko'chasi", lat: 41.3620, lng: 69.2890, fuelTypes: ['gaz'] },
    { name: 'Hayot Gaz — Chilonzor', brand: 'Hayot Gaz', address: "Chilonzor tumani, Bunyodkor shoh ko'chasi", lat: 41.2810, lng: 69.2040, fuelTypes: ['gaz', 'propan'] },
    { name: 'UzGaz — Sergeli', brand: 'UzGaz', address: "Sergeli tumani, Yangi Sergeli ko'chasi", lat: 41.2230, lng: 69.2210, fuelTypes: ['gaz'] },
    { name: 'UNG Petro — Yakkasaroy', brand: 'UNG Petro', address: "Yakkasaroy tumani, Bobur ko'chasi", lat: 41.2900, lng: 69.2530, fuelTypes: ['benzin', 'propan'] },
    { name: "Metan Servis — Mirzo Ulug'bek", brand: 'Metan Servis', address: "Mirzo Ulug'bek tumani, Buyuk Ipak Yo'li", lat: 41.3300, lng: 69.3320, fuelTypes: ['gaz'] },
    { name: 'Hayot Gaz — Bektemir', brand: 'Hayot Gaz', address: "Bektemir tumani, Toshkent halqa yo'li", lat: 41.2100, lng: 69.3340, fuelTypes: ['gaz', 'benzin'] },
  ];
  for (const st of placeholders ? fuelStations : []) {
    const existing = await prisma.fuelStation.findFirst({ where: { name: st.name } });
    if (existing) continue;
    await prisma.fuelStation.create({ data: { ...st, contracted: true, active: true } });
  }
  console.log(placeholders ? `Seeded ${fuelStations.length} fuel stations (placeholder coordinates)` : 'Skipped placeholder fuel stations (production)');

  // Service works catalogue — placeholder intervals until the fleet manager
  // corrects them in the admin panel. Same for every truck; kilometres only.
  const serviceReasons: { name: string; intervalKm: number | null }[] = [
    { name: 'Moy almashtirish', intervalKm: 10_000 },
    { name: 'Moy filtri', intervalKm: 10_000 },
    { name: 'Havo filtri', intervalKm: 20_000 },
    { name: "Yoqilg'i filtri", intervalKm: 30_000 },
    { name: 'Tormoz kolodkalari', intervalKm: 40_000 },
    { name: 'Tormoz suyuqligi', intervalKm: 60_000 },
    { name: 'Antifriz', intervalKm: 60_000 },
    { name: 'Shina almashtirish', intervalKm: null },
    { name: 'Akkumulyator', intervalKm: null },
    { name: "Boshqa ta'mirlash", intervalKm: null },
  ];
  const reasonIds = new Map<string, string>();
  for (const r of serviceReasons) {
    const existing = await prisma.serviceReason.findFirst({ where: { name: r.name, approved: true } });
    const row = existing ?? (await prisma.serviceReason.create({ data: { ...r, approved: true, active: true } }));
    reasonIds.set(r.name, row.id);
  }
  console.log(`Seeded ${serviceReasons.length} service reasons`);

  // Placeholder service centres. Same caveat as the fuel stations.
  const serviceCenters = [
    { name: 'Avto Servis — Sergeli', brand: 'Avto Servis', address: "Sergeli tumani, Yangi Sergeli ko'chasi", lat: 41.2245, lng: 69.2190 },
    { name: 'Isuzu Servis Markazi', brand: 'Isuzu', address: "Yashnobod tumani, Fargona yo'li", lat: 41.2980, lng: 69.3260 },
  ];
  for (const c of placeholders ? serviceCenters : []) {
    const existing = await prisma.serviceCenter.findFirst({ where: { name: c.name } });
    if (!existing) await prisma.serviceCenter.create({ data: { ...c, contracted: true, active: true } });
  }
  console.log(placeholders ? `Seeded ${serviceCenters.length} service centres (placeholder coordinates)` : 'Skipped placeholder service centres (production)');

  // A baseline for every vehicle that has a km reading, so the due list and
  // the reminders have something to compute from on day one: oil as if done
  // 7 000 km ago (comes due in 3 000), air filter as if done 12 000 km ago.
  // Real trucks get their real last-done km set by admin.
  const vehicles = await prisma.vehicle.findMany({ where: { currentKm: { not: null } }, select: { id: true, currentKm: true } });
  const baselines: [string, number][] = [['Moy almashtirish', 7_000], ['Moy filtri', 7_000], ['Havo filtri', 12_000]];
  let states = 0;
  for (const v of vehicles) {
    for (const [name, ago] of baselines) {
      const reasonId = reasonIds.get(name)!;
      const exists = await prisma.vehicleServiceState.findUnique({ where: { vehicleId_reasonId: { vehicleId: v.id, reasonId } } });
      if (exists) continue;
      await prisma.vehicleServiceState.create({
        data: { vehicleId: v.id, reasonId, lastDoneKm: Math.max(0, (v.currentKm ?? 0) - ago), lastDoneAt: new Date() },
      });
      states += 1;
    }
  }
  console.log(`Seeded ${states} service baselines across ${vehicles.length} vehicle(s) with km`);

  // Official Uzbekistan geo reference (region -> district), from MHOBT data.
  const geo = JSON.parse(
    readFileSync(join(__dirname, 'data', 'uz-geo.json'), 'utf8'),
  ) as {
    regions: { code: string; name: string; is_city: boolean }[];
    districts: { code: string; name: string; region_code: string }[];
  };
  await prisma.region.createMany({
    data: geo.regions.map((r) => ({ code: r.code, name: r.name, isCity: r.is_city })),
    skipDuplicates: true,
  });
  await prisma.geoDistrict.createMany({
    data: geo.districts.map((d) => ({ code: d.code, name: d.name, regionCode: d.region_code })),
    skipDuplicates: true,
  });
  console.log(`Seeded ${geo.regions.length} regions, ${geo.districts.length} districts`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
