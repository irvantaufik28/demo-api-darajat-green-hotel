import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { hotelFacilities } from "./schema/hotel_facilities.schema.js";
import { hotelInfo } from "./schema/hotel_info.schema.js";

// Snapshot of the current Green Hero website content. Keep this seed independent
// from the website repository so it can run in every API environment.
const hotel = {
  id: 1,
  name: "Green Hero Darajat",
  shortDescription:
    "Hotel & resor ramah keluarga di kawasan dataran tinggi Darajat Pass, Garut. Menggabungkan kenyamanan alami, kolam air panas, dan panorama perbukitan asri.",
  description:
    "Green Hero Darajat menawarkan pengalaman menginap yang nyaman untuk keluarga dengan suasana pegunungan dan fasilitas yang mendukung liburan santai. Berada tepat di kawasan dataran tinggi Garut, udara segar dan panorama alam menjadi teman terbaik istirahat Anda.",
  address: "Jl. Raya Darajat KM 14, Karyamekar, Pasirwangi, Garut, Jawa Barat 44161",
  district: "Pasirwangi",
  city: "Kabupaten Garut",
  province: "Jawa Barat",
  postalCode: "44161",
  googleMapsUrl: "https://maps.google.com/?q=Green+Hero+Darajat+Garut",
  phone: "(0262) 543-890",
  whatsappNumber: "+62 812-3456-7890",
  email: "reservation@greenherodarajat.com",
} as const;

const facilities = [
  {
    kind: "facility",
    name: "Outdoor swimming pool",
    description: "Kolam renang luar ruang di tengah udara pegunungan Darajat.",
  },
  {
    kind: "facility",
    name: "Warm pool (36°C – 38°C)",
    description: "Kolam air hangat alami untuk relaksasi tamu.",
  },
  {
    kind: "facility",
    name: "Natural Hot tub",
    description: "Area berendam dengan air panas alami Darajat.",
  },
  {
    kind: "facility",
    name: "Kids warm pool",
    description: "Kolam air hangat khusus anak.",
  },
  {
    kind: "facility",
    name: "Restaurant & Dining Lounge",
    description: "Tempat bersantap keluarga dengan pemandangan pegunungan terbuka.",
  },
  {
    kind: "facility",
    name: "Children-friendly open garden & seating",
    description: "Taman rumput luas dan tempat duduk untuk keluarga.",
  },
  {
    kind: "facility",
    name: "Free Guest Parking",
    description: "Area parkir untuk kendaraan pribadi maupun bus pariwisata.",
  },
  {
    kind: "facility",
    name: "Free High-Speed Wi-Fi",
    description: "Akses internet di area publik hotel.",
  },
  {
    kind: "service",
    name: "24-Hour Front Desk",
    description: "Resepsionis siaga 24 jam untuk kebutuhan tamu.",
  },
  {
    kind: "service",
    name: "Daily Housekeeping",
    description: "Pembersihan kamar harian dan perawatan linen.",
  },
  {
    kind: "service",
    name: "Luggage Storage",
    description: "Penitipan barang sebelum check-in atau setelah check-out.",
  },
  {
    kind: "service",
    name: "Room Service",
    description: "Layanan pesan antar makanan dan minuman ke kamar.",
  },
] as const;

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });

  try {
    await db.transaction(async (tx) => {
      await tx.insert(hotelInfo).values(hotel).onConflictDoNothing({ target: hotelInfo.id });

      for (const [sortOrder, facility] of facilities.entries()) {
        await tx
          .insert(hotelFacilities)
          .values({ hotelId: hotel.id, ...facility, sortOrder })
          .onConflictDoNothing({
            target: [hotelFacilities.hotelId, hotelFacilities.kind, hotelFacilities.name],
          });
      }
    });

    console.info(`Seeded hotel info and ${facilities.length} facilities/services.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("Hotel seed failed:", error);
  process.exitCode = 1;
});
