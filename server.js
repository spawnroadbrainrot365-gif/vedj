
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

const FIREBASE_URL = "http://datainfo.up.railway.app/Firebases/212798369".replace(/\/+$/, "");
const ADMIN_CODE = "gA819#71819_$91";
const ADMIN_PASSWORD = "gA819#71819_$91";
const SESSION_SECRET = "idk123idk123idk123";


const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || "/data";
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const LOCAL_DB_FILE = path.join(DATA_DIR, "videos-local.json");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function readLocalVideos() {
  try {
    if (!fs.existsSync(LOCAL_DB_FILE)) return {};
    const data = JSON.parse(fs.readFileSync(LOCAL_DB_FILE, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch (error) {
    console.error("Local DB read error:", error.message);
    return {};
  }
}

let localVideos = readLocalVideos();

function writeLocalVideos(videos) {
  const tempFile = `${LOCAL_DB_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(videos, null, 2));
  fs.renameSync(tempFile, LOCAL_DB_FILE);
  localVideos = videos;
}

function saveLocalQuietly(videos) {
  try {
    writeLocalVideos(videos);
  } catch (error) {
    console.error("Local DB write error:", error.message);
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, UPLOAD_DIR),
  filename: (_req, file, callback) => {
    const ext = path.extname(file.originalname)
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, "")
      .slice(0, 12);

    callback(null, `${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 1024,
    files: 2
  },
  fileFilter: (_req, file, callback) => {
    const valid = file.fieldname === "video"
      ? file.mimetype.startsWith("video/")
      : file.fieldname === "thumbnail" && file.mimetype.startsWith("image/");

    callback(valid ? null : new Error("اختر ملف فيديو وصورة مصغرة بصيغة صحيحة."), valid);
  }
});

app.use(express.json({ limit: "9999mb" }));
app.use(express.static(__dirname));

app.use("/uploads", express.static(UPLOAD_DIR, {
  acceptRanges: true,
  maxAge: "1d"
}));

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));

  return left.length === right.length &&
    crypto.timingSafeEqual(left, right);
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET)
    .update(value)
    .digest("hex");
}

function createToken() {
  const payload = Buffer.from(JSON.stringify({
    role: "admin",
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000
  })).toString("base64url");

  return `${payload}.${sign(payload)}`;
}

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || "")
    .replace(/^Bearer\s+/i, "");

  const parts = token.split(".");

  if (
    parts.length !== 2 ||
    !safeEqual(sign(parts[0]), parts[1])
  ) {
    return res.status(401).json({
      error: "جلسة الإدارة غير صالحة. سجل الدخول مجدداً."
    });
  }

  try {
    const payload = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8")
    );

    if (payload.role !== "admin" || payload.exp < Date.now()) {
      return res.status(401).json({
        error: "انتهت جلسة الإدارة. سجل الدخول مجدداً."
      });
    }
  } catch {
    return res.status(401).json({
      error: "رمز الدخول غير صالح."
    });
  }

  next();
}

async function firebaseRequest(route, method = "GET", body) {
  const response = await fetch(`${FIREBASE_URL}/${route}.json`, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body) })
  });

  const raw = await response.text();

  let data = null;

  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!response.ok) {
    throw new Error(
      typeof data === "string"
        ? data
        : (data && data.error) || `Database error: ${response.status}`
    );
  }

  return data;
}

app.post("/api/admin/login", (req, res) => {
  const { code, password } = req.body || {};

  if (
    !safeEqual(code || "", ADMIN_CODE) ||
    !safeEqual(password || "", ADMIN_PASSWORD)
  ) {
    return res.status(401).json({
      error: "الرمز أو كلمة المرور غير صحيحة."
    });
  }

  res.json({
    token: createToken(),
    expiresIn: 7 * 24 * 60 * 60 * 1000
  });
});

app.post("/api/upload", requireAdmin, (req, res, next) => {
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 }
  ])(req, res, error => {
    if (error) {
      return res.status(400).json({
        error: error.code === "LIMIT_FILE_SIZE"
          ? "حجم الملف أكبر من 1GB."
          : error.message
      });
    }

    next();
  });
}, (req, res) => {
  const videoFile = req.files?.video?.[0];
  const thumbnailFile = req.files?.thumbnail?.[0];

  if (!videoFile && !thumbnailFile) {
    return res.status(400).json({
      error: "اختر ملفاً للرفع."
    });
  }

  res.status(201).json({
    ...(videoFile
      ? { VideoUrl: `/uploads/${videoFile.filename}` }
      : {}),
    ...(thumbnailFile
      ? { Thumbnail: `/uploads/${thumbnailFile.filename}` }
      : {})
  });
});

function removeManagedUpload(url) {
  if (typeof url !== "string" || !url.startsWith("/uploads/")) {
    return;
  }

  const filename = path.basename(url);

  fs.promises.unlink(
    path.join(UPLOAD_DIR, filename)
  ).catch(() => {});
}

app.get("/api/videos", async (_req, res) => {
  try {
    const videos = await firebaseRequest("Videos");
    const result = videos && typeof videos === "object" ? videos : {};

    saveLocalQuietly(result);

    res.set("Cache-Control", "no-store");
    res.json(result);
  } catch (error) {
    console.warn("Firebase unavailable:", error.message);

    res.set("X-Video-Storage", "local-fallback");
    res.set("Cache-Control", "no-store");
    res.json(localVideos);
  }
});

app.post("/api/videos", requireAdmin, async (req, res) => {
  const video = req.body || {};

  if (!video.Title || !video.VideoUrl) {
    return res.status(400).json({
      error: "عنوان الفيديو ورابط الفيديو مطلوبان."
    });
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
    await firebaseRequest(
      `Videos/${encodeURIComponent(id)}`,
      "PUT",
      record
    );

    saveLocalQuietly({
      ...localVideos,
      [id]: record
    });

    res.status(201).json({
      id,
      video: record,
      storage: "firebase"
    });
  } catch (error) {
    console.warn("Firebase save failed:", error.message);

    try {
      writeLocalVideos({
        ...localVideos,
        [id]: record
      });

      res.status(201).json({
        id,
        video: record,
        storage: "local"
      });
    } catch (localError) {
      res.status(500).json({
        error: `فشل الحفظ المحلي: ${localError.message}`
      });
    }
  }
});

app.patch("/api/videos/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;

  const allowed = [
    "Title",
    "Description",
    "VideoUrl",
    "Thumbnail",
    "Published"
  ];

  const patch = {};

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
      patch[key] = req.body[key];
    }
  }

  try {
    let oldRecord;

    try {
      oldRecord = await firebaseRequest(
        `Videos/${encodeURIComponent(id)}`
      );
    } catch {
      oldRecord = localVideos[id];
    }

    let result;

    try {
      result = await firebaseRequest(
        `Videos/${encodeURIComponent(id)}`,
        "PATCH",
        patch
      );

      result = result || {
        ...(oldRecord || {}),
        ...patch
      };

      saveLocalQuietly({
        ...localVideos,
        [id]: result
      });
    } catch (error) {
      console.warn("Firebase update failed:", error.message);

      if (!localVideos[id] && !oldRecord) {
        return res.status(404).json({
          error: "الفيديو غير موجود."
        });
      }

      result = {
        ...(localVideos[id] || oldRecord),
        ...patch
      };

      writeLocalVideos({
        ...localVideos,
        [id]: result
      });
    }

    if (patch.VideoUrl && oldRecord?.VideoUrl !== patch.VideoUrl) {
      removeManagedUpload(oldRecord?.VideoUrl);
    }

    if (patch.Thumbnail && oldRecord?.Thumbnail !== patch.Thumbnail) {
      removeManagedUpload(oldRecord?.Thumbnail);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error.message || "تعذر تعديل الفيديو."
    });
  }
});

app.delete("/api/videos/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  const oldRecord = localVideos[id];

  try {
    try {
      const firebaseRecord = await firebaseRequest(
        `Videos/${encodeURIComponent(id)}`
      );

      await firebaseRequest(
        `Videos/${encodeURIComponent(id)}`,
        "DELETE"
      );

      removeManagedUpload(firebaseRecord?.VideoUrl);
      removeManagedUpload(firebaseRecord?.Thumbnail);
    } catch (error) {
      console.warn("Firebase delete failed:", error.message);
    }

    const updated = { ...localVideos };
    delete updated[id];

    writeLocalVideos(updated);

    removeManagedUpload(oldRecord?.VideoUrl);
    removeManagedUpload(oldRecord?.Thumbnail);

    res.json({
      success: true,
      storage: "local-and-firebase"
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "تعذر حذف الفيديو."
    });
  }
});

app.get("/Home", (_req, res) =>
  res.sendFile(path.join(__dirname, "index.html"))
);

app.get("/Admin", (_req, res) =>
  res.sendFile(path.join(__dirname, "index.html"))
);

app.get("/Watch/:id", (_req, res) =>
  res.sendFile(path.join(__dirname, "index.html"))
);

app.get("*", (_req, res) =>
  res.sendFile(path.join(__dirname, "index.html"))
);

app.listen(PORT, () => {
  console.log(`Video Library running on port ${PORT}`);
  console.log(`Uploads directory: ${UPLOAD_DIR}`);
  console.log(`Local database: ${LOCAL_DB_FILE}`);
});
