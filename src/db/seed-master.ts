import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { capacityPatterns } from "./schema/capacity_patterns.schema.js";
import { masterItems } from "./schema/master_items.schema.js";

type MasterCategory = {
  category: string;
  names: readonly string[];
};

// Amenities follow the room form's amenityGroups, not the shorter Master page examples.
const categories: MasterCategory[] = [
  {
    category: "amenities",
    names: [
      "Air Conditioning",
      "Balcony",
      "Mountain View",
      "Wardrobe",
      "Work Desk",
      "Fireplace",
      "Hot Water",
      "Shower",
      "Towels",
      "Toiletries",
      "Bathtub",
      "Hairdryer",
      "WiFi",
      "Television",
      "Cable Channels",
      "Smart TV / Streaming",
      "Kettle",
      "Refrigerator",
      "Drinking Water",
      "Minibar",
      "Tea & Coffee Set",
    ],
  },
  { category: "bed_types", names: ["King Bed", "Queen Bed", "Twin Bed", "Single Bed"] },
  { category: "meal_types", names: ["Room Only", "Breakfast Included"] },
  { category: "room_view_types", names: ["Mountain View", "Pool View", "Garden View"] },
  { category: "floors", names: ["Ground Floor", "1st Floor", "2nd Floor"] },
  { category: "experience_categories", names: ["Dining", "Celebrate"] },
  { category: "ota_channels", names: ["Agoda", "Traveloka", "Booking.com", "Tiket.com"] },
  { category: "payment_methods", names: ["Cash", "Transfer", "QRIS", "Payment Gateway"] },
  { category: "cancellation_policy_types", names: ["Flexible", "Non-refundable", "Custom"] },
];

// Child capacity can match adult capacity; selection belongs to each room type.
const occupancyCombinations = Array.from({ length: 15 }, (_, index) => index + 1).flatMap(
  (adults) => Array.from({ length: adults + 1 }, (_, children) => [adults, children] as const),
);

function codeFor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });

  try {
    await db.transaction(async (tx) => {
      for (const { category, names } of categories) {
        for (const [sortOrder, name] of names.entries()) {
          const code = codeFor(name);
          await tx
            .insert(masterItems)
            .values({ category, code, name, sortOrder })
            .onConflictDoUpdate({
              target: [masterItems.category, masterItems.code],
              set: { name, sortOrder },
            });
        }
      }

      for (const [sortOrder, [adults, children]] of occupancyCombinations.entries()) {
        await tx
          .insert(capacityPatterns)
          .values({ adults, children, sortOrder })
          .onConflictDoUpdate({
            target: [capacityPatterns.adults, capacityPatterns.children],
            set: { sortOrder },
          });
      }
    });

    const total = categories.reduce((count, category) => count + category.names.length, 0);
    console.info(
      `Seeded ${total} master items across ${categories.length} categories and ${occupancyCombinations.length} capacity patterns.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("Master seed failed:", error);
  process.exitCode = 1;
});
