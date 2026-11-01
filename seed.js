import "dotenv/config";
import { MongoClient } from "mongodb";

const {
  MONGODB_URI,
  SEED_EMAIL = "team@shohay.org",
  SEED_NAME = "Shohay Team",
} = process.env;
if (!MONGODB_URI) {
  console.error("MONGODB_URI is missing from .env");
  process.exit(1);
}

const img = (id) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=800&q=70`;
const inDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const events = [
  {
    title: "Winter Clothes Distribution",
    type: "Donation",
    date: inDays(14),
    location: "Mirpur 10 Community Field, Dhaka",
    thumbnail: img("photo-1488521787991-ed7bbaae773c"),
    description:
      "We are handing out warm jackets, sweaters and socks to families ahead of the cold season. Volunteers are needed to sort clothes by size from 9 AM and to help at the distribution desk after 11 AM. Bring clean, usable winter clothes if you can.",
  },
  {
    title: "Neighbourhood Tree Planting Day",
    type: "Plantation",
    date: inDays(21),
    location: "Uttara Sector 7 Park, Dhaka",
    thumbnail: img("photo-1593113598332-cd288d649433"),
    description:
      "Join us to plant 200 saplings of neem, mahogany and krishnachura along the park boundary. Saplings and tools are provided. Wear closed shoes and bring a water bottle.",
  },
  {
    title: "Hot Khichuri and Ration Pack Drive",
    type: "Food Drive",
    date: inDays(28),
    location: "Mohammadpur Town Hall Field, Dhaka",
    thumbnail: img("photo-1559027615-cd4628902d4a"),
    description:
      "We are serving hot khichuri and packing dry ration bags for 150 families. Help is needed with cooking support, packing and serving. Arrive by 10 AM; no experience needed.",
  },
  {
    title: "Hatirjheel Lakeside Cleanup",
    type: "Cleanup",
    date: inDays(35),
    location: "Hatirjheel, Dhaka",
    thumbnail: img("photo-1532629345422-7515f3d16bb6"),
    description:
      "Gloves and bags are provided. We will clean the walkway and the water's edge in small teams, then sort what we collect for recycling. Please wear old clothes and sturdy shoes.",
  },
  {
    title: "Free Winter Health Camp",
    type: "Health Camp",
    date: inDays(42),
    location: "Shyamoli Community Centre, Dhaka",
    thumbnail: img("photo-1509099836639-18ba1795216d"),
    description:
      "Volunteer doctors will offer free blood pressure, blood sugar and cold-related check-ups. We need volunteers for registration and queue support. Doctors and nurses are welcome to join the team.",
  },
  {
    title: "Winter Reading Drive for Children",
    type: "Education",
    date: inDays(49),
    location: "Dhanmondi Lake Park, Dhaka",
    thumbnail: img("photo-1469571486292-0ba58a3f068b"),
    description:
      "A morning of story reading, drawing and a small book swap for children aged 5 to 12. We are collecting story books, notebooks and pencils. Volunteers will read aloud and run the activity tables.",
  },
];

const client = new MongoClient(MONGODB_URI);
try {
  await client.connect();
  const col = client.db().collection("events");
  for (const e of events) {
    await col.updateOne(
      { title: e.title, creatorEmail: SEED_EMAIL },
      {
        $set: { ...e, creatorEmail: SEED_EMAIL, creatorName: SEED_NAME },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
  }
  console.log(`Seeded ${events.length} events for ${SEED_EMAIL}`);
} finally {
  await client.close();
}
