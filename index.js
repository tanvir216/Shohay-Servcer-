import "dotenv/config";
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const {
  PORT = 5000,
  MONGODB_URI,
  CLIENT_URL = "http://localhost:3000",
} = process.env;

app.use(cors({ origin: CLIENT_URL.split(","), credentials: true }));
app.use(express.json());

const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
let events, joins;
const db = async () => {
  if (!events) {
    await client.connect();
    const d = client.db();
    events = d.collection("events");
    joins = d.collection("joins");
    await joins.createIndex({ eventId: 1, userEmail: 1 }, { unique: true });
  }
};

// JWTs are issued by BetterAuth on the client app and verified here through its JWKS endpoint.
const JWKS = createRemoteJWKSet(
  new URL(`${CLIENT_URL.split(",")[0]}/api/auth/jwks`),
);
const verifyJWT = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token)
    return res.status(401).json({ message: "Please log in to continue." });
  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = {
      email: payload.email,
      name: payload.name,
      id: payload.id || payload.sub,
    };
    next();
  } catch {
    res
      .status(401)
      .json({ message: "Your session has expired. Please log in again." });
  }
};

const today = () => new Date().toISOString().slice(0, 10);
const oid = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);
const clean = (b) => ({
  title: String(b.title || "").trim(),
  description: String(b.description || "").trim(),
  type: String(b.type || "").trim(),
  thumbnail: String(b.thumbnail || "").trim(),
  location: String(b.location || "").trim(),
  date: String(b.date || "").trim(),
});
const invalid = (e) =>
  Object.values(e).some((v) => !v)
    ? "All fields are required."
    : e.date <= today()
      ? "Event date must be in the future."
      : null;

app.get("/", (_req, res) => res.json({ message: "Shohay API is running" }));
app.use(async (_req, _res, next) => (await db(), next()));

// Public: upcoming events only
app.get("/events", async (req, res) => {
  const { limit = 0, type, search } = req.query;
  const q = { date: { $gte: today() } };
  if (type && type !== "All") q.type = type;
  if (search)
    q.title = {
      $regex: String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      $options: "i",
    };
  res.json(
    await events.find(q).sort({ date: 1 }).limit(Number(limit)).toArray(),
  );
});

app.get("/events/:id", async (req, res) => {
  const _id = oid(req.params.id);
  const ev = _id && (await events.findOne({ _id }));
  ev ? res.json(ev) : res.status(404).json({ message: "Event not found." });
});

app.post("/events", verifyJWT, async (req, res) => {
  const ev = clean(req.body);
  const err = invalid(ev);
  if (err) return res.status(400).json({ message: err });
  const r = await events.insertOne({
    ...ev,
    creatorEmail: req.user.email,
    creatorName: req.user.name,
    createdAt: new Date(),
  });
  res.status(201).json({ _id: r.insertedId });
});

app.get("/my-events", verifyJWT, async (req, res) =>
  res.json(
    await events
      .find({ creatorEmail: req.user.email })
      .sort({ date: 1 })
      .toArray(),
  ),
);

app.put("/events/:id", verifyJWT, async (req, res) => {
  const _id = oid(req.params.id);
  const ev = clean(req.body);
  const err = invalid(ev);
  if (err) return res.status(400).json({ message: err });
  const r = await events.updateOne(
    { _id, creatorEmail: req.user.email },
    { $set: ev },
  );
  r.matchedCount
    ? res.json({ ok: true })
    : res
        .status(403)
        .json({ message: "You can only update events you created." });
});

app.delete("/events/:id", verifyJWT, async (req, res) => {
  const _id = oid(req.params.id);
  const r = await events.deleteOne({ _id, creatorEmail: req.user.email });
  if (!r.deletedCount)
    return res
      .status(403)
      .json({ message: "You can only delete events you created." });
  await joins.deleteMany({ eventId: String(_id) });
  res.json({ ok: true });
});

app.post("/events/:id/join", verifyJWT, async (req, res) => {
  const _id = oid(req.params.id);
  const ev = _id && (await events.findOne({ _id }));
  if (!ev) return res.status(404).json({ message: "Event not found." });
  if (ev.date < today())
    return res
      .status(400)
      .json({ message: "This event has already taken place." });
  try {
    await joins.insertOne({
      eventId: String(_id),
      userEmail: req.user.email,
      userName: req.user.name,
      joinedAt: new Date(),
      event: {
        title: ev.title,
        thumbnail: ev.thumbnail,
        location: ev.location,
        type: ev.type,
        date: ev.date,
      },
    });
    res.status(201).json({ ok: true });
  } catch (e) {
    e.code === 11000
      ? res.status(409).json({ message: "You have already joined this event." })
      : res.status(500).json({ message: "Could not join the event." });
  }
});

app.get("/joined", verifyJWT, async (req, res) =>
  res.json(
    await joins
      .find({ userEmail: req.user.email })
      .sort({ "event.date": 1 })
      .toArray(),
  ),
);

app.use((err, _req, res, _next) =>
  res.status(500).json({ message: err.message || "Server error" }),
);
app.listen(PORT, () => console.log(`Shohay API on :${PORT}`));
export default app;
