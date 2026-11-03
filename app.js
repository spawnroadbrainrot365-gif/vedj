const $ = (id) => document.getElementById(id);
const TOKEN_KEY = "vidora_admin_token";
let videosCache = {};
let toastTimer;

function currentRoute() {
  const path = decodeURIComponent(location.pathname);
  if (path.toLowerCase() === "/admin") return "admin";
  if (path.toLowerCase().startsWith("/watch/")) return "watch";
  return "home";
}

function showPage(name) {
  ["homePage", "watchPage", "adminPage"].forEach(id => $(id).classList.add("hidden"));
  $(`${name}Page`).classList.remove("hidden");
}

function getToken() { return localStorage.getItem(TOKEN_KEY); }

async function api(url, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = { ...(!isFormData && options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
  if (getToken()) headers.Authorization = `Bearer ${getToken()}`;
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "حدث خطأ غير متوقع.");
  return data;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function showToast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2600);
}

function videoThumbnail(video) {
  return video.Thumbnail
    ? `<img src="${escapeHtml(video.Thumbnail)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<div class=&quot;thumb-placeholder&quot;>▶</div>'">`
    : `<div class="thumb-placeholder">▶</div>`;
}

async function loadHome() {
  showPage("home");
  $("homeState").classList.remove("hidden");
  $("homeState").innerHTML = '<div class="state-icon">◌</div><h3>جاري تحميل المكتبة</h3><p>لحظات ونجهز لك الفيديوهات.</p>';
  try {
    const data = await api("/api/videos");
    const published = Object.entries(data || {}).filter(([, video]) => video && video.Published);
    $("videoCount").textContent = `${published.length} فيديو`;
    $("videoGrid").innerHTML = published.map(([id, video]) => `
      <article class="video-card" data-watch="${encodeURIComponent(id)}">
        <div class="thumb">${videoThumbnail(video)}<span class="play-badge">▶</span></div>
        <div class="video-card-body"><h3>${escapeHtml(video.Title || "بدون عنوان")}</h3><p>${escapeHtml(video.Description || "شاهد الفيديو الآن.")}</p></div>
      </article>`).join("");
    $("homeState").classList.toggle("hidden", published.length > 0);
    if (!published.length) $("homeState").innerHTML = '<div class="state-icon">▣</div><h3>المكتبة فارغة حالياً</h3><p>لا توجد فيديوهات منشورة في الوقت الحالي.</p>';
    $("videoGrid").querySelectorAll("[data-watch]").forEach(card => {
      card.addEventListener("click", () => location.href = `/Watch/${card.dataset.watch}`);
    });
  } catch (error) {
    $("homeState").classList.remove("hidden");
    $("homeState").innerHTML = `<div class="state-icon">!</div><h3>تعذر تحميل الفيديوهات</h3><p>${escapeHtml(error.message)}</p>`;
  }
}

async function loadWatch() {
  showPage("watch");
  const id = decodeURIComponent(location.pathname.split("/").slice(2).join("/"));
  try {
    const data = await api("/api/videos");
    const video = data && data[id];
    if (!video || !video.Published) throw new Error("هذا الفيديو غير متاح أو لم يعد منشوراً.");
    $("watchTitle").textContent = video.Title || "بدون عنوان";
    $("watchDescription").textContent = video.Description || "";
    $("videoPlayer").src = video.VideoUrl;
    document.title = `${video.Title || "مشاهدة"} | VIDORA`;
  } catch (error) {
    $("watchTitle").textContent = "تعذر فتح الفيديو";
    $("watchDescription").textContent = error.message;
  }
}

function showLogin() {
  $("loginView").classList.remove("hidden");
  $("dashboardView").classList.add("hidden");
}

async function loadAdmin() {
  showPage("admin");
  if (!getToken()) return showLogin();
  $("loginView").classList.add("hidden");
  $("dashboardView").classList.remove("hidden");
  try {
    videosCache = await api("/api/videos");
    renderAdmin();
  } catch (error) {
    if (error.message.includes("جلسة") || error.message.includes("رمز الدخول")) {
      localStorage.removeItem(TOKEN_KEY);
      showLogin();
    } else {
      $("adminVideoList").innerHTML = `<div class="state-card"><h3>تعذر تحميل البيانات</h3><p>${escapeHtml(error.message)}</p></div>`;
    }
  }
}

function renderAdmin() {
  const entries = Object.entries(videosCache || {}).filter(([, video]) => video);
  const published = entries.filter(([, video]) => video.Published);
  $("totalStat").textContent = entries.length;
  $("publishedStat").textContent = published.length;
  $("draftStat").textContent = entries.length - published.length;
  $("adminState").classList.toggle("hidden", entries.length > 0);
  $("adminVideoList").innerHTML = entries.map(([id, video]) => `
    <article class="admin-video">
      <div class="admin-thumb">${video.Thumbnail ? `<img src="${escapeHtml(video.Thumbnail)}" alt="" onerror="this.style.display='none'">` : "▶"}</div>
      <div class="admin-video-info"><strong>${escapeHtml(video.Title || "بدون عنوان")}</strong><small>${escapeHtml(video.Description || "بدون وصف")}</small></div>
      <span class="status ${video.Published ? "" : "draft"}">${video.Published ? "منشور" : "مسودة"}</span>
      <div class="admin-actions"><button class="small-btn" data-edit="${escapeHtml(id)}">تعديل</button><button class="small-btn delete" data-delete="${escapeHtml(id)}">حذف</button></div>
    </article>`).join("");
  $("adminVideoList").querySelectorAll("[data-edit]").forEach(button => button.addEventListener("click", () => openEditor(button.dataset.edit)));
  $("adminVideoList").querySelectorAll("[data-delete]").forEach(button => button.addEventListener("click", () => deleteVideo(button.dataset.delete)));
}

function openEditor(id = "") {
  $("videoForm").reset();
  $("editId").value = id;
  $("videoFormError").textContent = "";
  $("modalTitle").textContent = id ? "تعديل الفيديو" : "إضافة فيديو جديد";
  if (id && videosCache[id]) {
    const video = videosCache[id];
    $("videoTitle").value = video.Title || "";
    $("videoDescription").value = video.Description || "";
    $("videoFileHint").textContent = "اتركه فارغاً للاحتفاظ بالفيديو الحالي، أو اختر فيديو جديداً لاستبداله.";
    $("thumbnailFileHint").textContent = video.Thumbnail ? "اتركها فارغة للاحتفاظ بالصورة الحالية، أو اختر صورة جديدة." : "لا توجد صورة حالية.";
    $("videoPublished").checked = Boolean(video.Published);
  } else {
    $("videoFileHint").textContent = "اختر فيديو من جهازك (حتى 1GB).";
    $("thumbnailFileHint").textContent = "اختر صورة مصغرة من جهازك (اختياري).";
    $("videoPublished").checked = true;
  }
  $("videoFile").value = "";
  $("thumbnailFile").value = "";
  $("videoModal").classList.remove("hidden");
}

function closeEditor() { $("videoModal").classList.add("hidden"); }

async function saveVideo(event) {
  event.preventDefault();
  const id = $("editId").value;
  const current = id ? videosCache[id] : null;
  const videoFile = $("videoFile").files[0];
  const thumbnailFile = $("thumbnailFile").files[0];
  if (!id && (!videoFile || !thumbnailFile)) {
    $("videoFormError").textContent = "اختر ملف الفيديو والصورة المصغرة من جهازك.";
    return;
  }

  const video = {
    Title: $("videoTitle").value.trim(),
    VideoUrl: current?.VideoUrl || "",
    Thumbnail: current?.Thumbnail || "",
    Description: $("videoDescription").value.trim(),
    Published: $("videoPublished").checked
  };
  $("saveVideoBtn").disabled = true;
  $("saveVideoBtn").textContent = "جارٍ رفع الملفات...";
  $("videoFormError").textContent = "";
  try {
    if (videoFile || thumbnailFile) {
      const formData = new FormData();
      if (videoFile) formData.append("video", videoFile);
      if (thumbnailFile) formData.append("thumbnail", thumbnailFile);
      const uploaded = await api("/api/upload", { method: "POST", body: formData });
      if (uploaded.VideoUrl) video.VideoUrl = uploaded.VideoUrl;
      if (uploaded.Thumbnail) video.Thumbnail = uploaded.Thumbnail;
    }
    if (!video.VideoUrl || (!id && !video.Thumbnail)) throw new Error("اختر ملف الفيديو والصورة المصغرة من جهازك.");
    $("saveVideoBtn").textContent = "جارٍ حفظ البيانات...";
    if (id) await api(`/api/videos/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(video) });
    else await api("/api/videos", { method: "POST", body: JSON.stringify(video) });
    closeEditor();
    showToast(id ? "تم تحديث الفيديو." : "تمت إضافة الفيديو.");
    await loadAdmin();
  } catch (error) {
    $("videoFormError").textContent = error.message;
  } finally {
    $("saveVideoBtn").disabled = false;
    $("saveVideoBtn").textContent = "حفظ الفيديو";
  }
}

async function deleteVideo(id) {
  const video = videosCache[id];
  if (!confirm(`هل تريد حذف "${video?.Title || "هذا الفيديو"}" نهائياً؟`)) return;
  try {
    await api(`/api/videos/${encodeURIComponent(id)}`, { method: "DELETE" });
    showToast("تم حذف الفيديو.");
    await loadAdmin();
  } catch (error) { showToast(error.message); }
}

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("loginError").textContent = "";
  const button = $("loginForm").querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const result = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ code: $("adminCode").value, password: $("adminPassword").value })
    });
    localStorage.setItem(TOKEN_KEY, result.token);
    $("adminPassword").value = "";
    showToast("تم تسجيل الدخول بنجاح.");
    await loadAdmin();
  } catch (error) {
    $("loginError").textContent = error.message;
  } finally { button.disabled = false; }
});

$("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  showLogin();
  showToast("تم تسجيل الخروج.");
});
$("addVideoBtn").addEventListener("click", () => openEditor());
$("videoForm").addEventListener("submit", saveVideo);
$("closeModal").addEventListener("click", closeEditor);
$("cancelModal").addEventListener("click", closeEditor);
$("videoModal").addEventListener("click", event => {
  if (event.target.dataset.close) closeEditor();
});

const route = currentRoute();
if (route === "admin") loadAdmin();
else if (route === "watch") loadWatch();
else loadHome();
