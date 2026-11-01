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
const ORIGINS = CLIENT_URL.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({ origin: ORIGINS, credentials: true }));
app.use(express.json({ limit: "100kb" }));

const EVENT_TYPES = [
  "Cleanup",
  "Plantation",
  "Donation",
  "Food Drive",
  "Health Camp",
  "Education",
];

const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
let events, joins, ready;
const db = () =>
  (ready ||= (async () => {
    await client.connect();
    const d = client.db();
    events = d.collection("events");
    joins = d.collection("joins");
    await Promise.all([
      joins.createIndex({ eventId: 1, userEmail: 1 }, { unique: true }),
      joins.createIndex({ userEmail: 1 }),
      events.createIndex({ date: 1 }),
      events.createIndex({ creatorEmail: 1 }),
    ]);
  })().catch((e) => {
    ready = null;
    throw e;
  }));


  

const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const JWKS = createRemoteJWKSet(new URL(`${ORIGINS[0]}/api/auth/jwks`));
const verifyJWT = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token)
    return res.status(401).json({ message: "Please log in to continue." });
  try {
    const { payload } = await jwtVerify(token, JWKS);
    if (!payload.email) throw new Error("No email in token");
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
const urlOk = (u) => {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
};
const clean = (b = {}) => ({
  title: String(b.title || "").trim(),
  description: String(b.description || "").trim(),
  type: String(b.type || "").trim(),
  thumbnail: String(b.thumbnail || "").trim(),
  location: String(b.location || "").trim(),
  date: String(b.date || "").trim(),
});

const invalid = (e) => {
  if (Object.values(e).some((v) => !v)) return "All fields are required.";
  if (e.title.length < 5) return "Title needs at least 5 characters.";
  if (e.title.length > 120) return "Title can be at most 120 characters.";
  if (e.description.length < 20)
    return "Describe the event in at least 20 characters.";
  if (e.description.length > 3000)
    return "Description can be at most 3000 characters.";
  if (e.location.length > 150) return "Location can be at most 150 characters.";
  if (!EVENT_TYPES.includes(e.type)) return "Choose a valid event type.";
  if (e.thumbnail.length > 500 || !urlOk(e.thumbnail))
    return "Thumbnail must be a valid image URL.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || Number.isNaN(Date.parse(e.date)))
    return "Enter a valid event date.";
  if (e.date <= today()) return "Event date must be in the future.";
  return null;
};

const snapshot = (e) => ({
  title: e.title,
  thumbnail: e.thumbnail,
  location: e.location,
  type: e.type,
  date: e.date,
});
const notFound = (res) => res.status(404).json({ message: "Event not found." });

app.get("/", (_req, res) => res.json({ message: "Shohay API is running" }));
app.use(ah(async (_req, _res, next) => (await db(), next())));

app.get(
  "/events",
  ah(async (req, res) => {
    const { limit, type, search } = req.query;
    const max = Math.min(Math.max(parseInt(limit, 10) || 0, 0), 50); // 0 = no limit
    const q = { date: { $gte: today() } };
    if (type && type !== "All") q.type = String(type);
    if (search)
      q.title = {
        $regex: String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        $options: "i",
      };
    res.json(await events.find(q).sort({ date: 1 }).limit(max).toArray());
  }),
);

app.get(
  "/events/:id",
  ah(async (req, res) => {
    const _id = oid(req.params.id);
    const ev = _id && (await events.findOne({ _id }));
    if (!ev) return notFound(res);
    const joinedCount = await joins.countDocuments({ eventId: String(_id) });
    res.json({ ...ev, joinedCount });
  }),
);

app.post(
  "/events",
  verifyJWT,
  ah(async (req, res) => {
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
  }),
);

app.get(
  "/my-events",
  verifyJWT,
  ah(async (req, res) =>
    res.json(
      await events
        .find({ creatorEmail: req.user.email })
        .sort({ date: 1 })
        .toArray(),
    ),
  ),
);

app.put(
  "/events/:id",
  verifyJWT,
  ah(async (req, res) => {
    const _id = oid(req.params.id);
    if (!_id) return notFound(res);
    const ev = clean(req.body);
    const err = invalid(ev);
    if (err) return res.status(400).json({ message: err });
    const r = await events.updateOne(
      { _id, creatorEmail: req.user.email },
      { $set: ev },
    );
    if (!r.matchedCount)
      return res
        .status(403)
        .json({ message: "You can only update events you created." });
    await joins.updateMany(
      { eventId: String(_id) },
      { $set: { event: snapshot(ev) } },
    );
    res.json({ ok: true });
  }),
);

app.delete(
  "/events/:id",
  verifyJWT,
  ah(async (req, res) => {
    const _id = oid(req.params.id);
    if (!_id) return notFound(res);
    const r = await events.deleteOne({ _id, creatorEmail: req.user.email });
    if (!r.deletedCount)
      return res
        .status(403)
        .json({ message: "You can only delete events you created." });
    await joins.deleteMany({ eventId: String(_id) });
    res.json({ ok: true });
  }),
);

app.post(
  "/events/:id/join",
  verifyJWT,
  ah(async (req, res) => {
    const _id = oid(req.params.id);
    const ev = _id && (await events.findOne({ _id }));
    if (!ev) return notFound(res);
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
        event: snapshot(ev),
      });
      res.status(201).json({ ok: true });
    } catch (e) {
      if (e.code === 11000)
        return res
          .status(409)
          .json({ message: "You have already joined this event." });
      throw e;
    }
  }),
);

app.delete(
  "/events/:id/join",
  verifyJWT,
  ah(async (req, res) => {
    const _id = oid(req.params.id);
    if (!_id) return notFound(res);
    const r = await joins.deleteOne({
      eventId: String(_id),
      userEmail: req.user.email,
    });
    r.deletedCount
      ? res.json({ ok: true })
      : res.status(404).json({ message: "You have not joined this event." });
  }),
);

app.get(
  "/joined",
  verifyJWT,
  ah(async (req, res) =>
    res.json(
      await joins
        .find({ userEmail: req.user.email })
        .sort({ "event.date": 1 })
        .toArray(),
    ),
  ),
);

app.post(
  "/sync-profile",
  verifyJWT,
  ah(async (req, res) => {
    const name = String(req.user.name || "").trim();
    if (!name) return res.status(400).json({ message: "Name is missing." });
    const [a] = await Promise.all([
      events.updateMany(
        { creatorEmail: req.user.email },
        { $set: { creatorName: name } },
      ),
      joins.updateMany(
        { userEmail: req.user.email },
        { $set: { userName: name } },
      ),
    ]);
    res.json({ ok: true, events: a.modifiedCount });
  }),
);

app.use((_req, res) => res.status(404).json({ message: "Route not found." }));
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    message:
      status < 500
        ? err.message
        : "Something went wrong on our side. Please try again.",
  });
});

app.listen(PORT, () => console.log(`Shohay API on :${PORT}`));
export default app;
