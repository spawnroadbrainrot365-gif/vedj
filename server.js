require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const FIREBASE_URL = (process.env.FIREBASE_URL || "PUT_YOUR_FIREBASE_URL_HERE").replace(/\/+$/, "");
const ADMIN_CODE = process.env.ADMIN_CODE || "CHANGE_ME";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "CHANGE_ME";
const SESSION_SECRET = process.env.SESSION_SECRET || "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET";

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function createToken() {
  const payload = Buffer.from(JSON.stringify({
    role: "admin",
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length !== 2 || !safeEqual(sign(parts[0]), parts[1])) {
    return res.status(401).json({ error: "جلسة الإدارة غير صالحة. سجل الدخول مجدداً." });
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (payload.role !== "admin" || payload.exp < Date.now()) {
      return res.status(401).json({ error: "انتهت جلسة الإدارة. سجل الدخول مجدداً." });
    }
  } catch {
    return res.status(401).json({ error: "رمز الدخول غير صالح." });
  }
  next();
}

function firebaseReady(res) {
  if (!FIREBASE_URL || FIREBASE_URL.includes("PUT_YOUR_FIREBASE_URL_HERE")) {
    res.status(503).json({ error: "ضع رابط قاعدة البيانات في متغير FIREBASE_URL داخل Railway." });
    return false;
  }
  return true;
}

async function firebaseRequest(route, method = "GET", body) {
  const response = await fetch(`${FIREBASE_URL}/${route}.json`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    throw new Error(typeof data === "string" ? data : (data && data.error) || `Database error: ${response.status}`);
  }
  return data;
}

app.post("/api/admin/login", (req, res) => {
  const { code, password } = req.body || {};
  if (!safeEqual(code || "", ADMIN_CODE) || !safeEqual(password || "", ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "الرمز أو كلمة المرور غير صحيحة." });
  }
  res.json({ token: createToken(), expiresIn: 7 * 24 * 60 * 60 * 1000 });
});

app.get("/api/videos", async (req, res) => {
  if (!firebaseReady(res)) return;
  try {
    const videos = await firebaseRequest("Videos");
    res.set("Cache-Control", "no-store");
    res.json(videos || {});
  } catch (error) {
    res.status(502).json({ error: error.message || "تعذر الاتصال بقاعدة البيانات." });
  }
});

app.post("/api/videos", requireAdmin, async (req, res) => {
  if (!firebaseReady(res)) return;
  const video = req.body || {};
  if (!video.Title || !video.VideoUrl) {
    return res.status(400).json({ error: "عنوان الفيديو ورابط الفيديو مطلوبان." });
  }
  const id = `video_${crypto.randomUUID()}`;
  const record = {
    Title: String(video.Title).trim(),
    Description: String(video.Description || "").trim(),
    VideoUrl: String(video.VideoUrl).trim(),
    Thumbnail: String(video.Thumbnail || "").trim(),
    Published: Boolean(video.Published),
    CreatedAt: Date.now()
  };
  try {
    await firebaseRequest(`Videos/${encodeURIComponent(id)}`, "PUT", record);
    res.status(201).json({ id, video: record });
  } catch (error) {
    res.status(502).json({ error: error.message || "تعذرت إضافة الفيديو." });
  }
});

app.patch("/api/videos/:id", requireAdmin, async (req, res) => {
  if (!firebaseReady(res)) return;
  const allowed = ["Title", "Description", "VideoUrl", "Thumbnail", "Published"];
  const patch = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) patch[key] = req.body[key];
  }
  try {
    const result = await firebaseRequest(`Videos/${encodeURIComponent(req.params.id)}`, "PATCH", patch);
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: error.message || "تعذر تعديل الفيديو." });
  }
});

app.delete("/api/videos/:id", requireAdmin, async (req, res) => {
  if (!firebaseReady(res)) return;
  try {
    await firebaseRequest(`Videos/${encodeURIComponent(req.params.id)}`, "DELETE");
    res.json({ success: true });
  } catch (error) {
    res.status(502).json({ error: error.message || "تعذر حذف الفيديو." });
  }
});

app.get("/Home", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/Admin", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/Watch/:id", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, () => {
  console.log(`Video Library running on port ${PORT}`);
});
