const PASSWORD = "Jaroslava2025";
const MANTLE_BASE = `https://mantledb.sh/v2/${STORAGE_CONFIG.mantleNamespace}`;
const MANTLE_KEY = STORAGE_CONFIG.mantleKey;
const MAX_IMAGE_BYTES = 58000;
const MAX_STORED_PHOTO_BYTES = 64000;
const GALLERY_INITIAL_COUNT = 3;
const GALLERY_BATCH_SIZE = 10;

const DEFAULT_CONTACT = {
  email: "info@jaroslavaforro.com",
  phone: ""
};

let photosCache = [];
let reviewsCache = [];
let contactCache = { ...DEFAULT_CONTACT };
let currentLightboxIndex = null;
let galleryVisibleCount = GALLERY_INITIAL_COUNT;
let preferredImageMime = "image/jpeg";

function isAdmin() {
  return sessionStorage.getItem("admin") === "true";
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function parseStorageResponse(response, path = "") {
  if (response.status === 404) {
    return null;
  }

  const text = await response.text();

  if (!response.ok) {
    const fallback = path.includes("contact")
      ? "Nepodarilo sa uložiť kontaktné údaje. Skontrolujte internetové pripojenie a skúste znova."
      : "Nepodarilo sa uložiť. Skúste znova.";
    throw new Error(fallback);
  }

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function storageRequest(path, method = "GET", body = null) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Mantle-Key": MANTLE_KEY
    }
  };

  if (body !== null) {
    options.body = JSON.stringify(body);
  }

  let response;

  try {
    response = await fetch(`${MANTLE_BASE}${path}`, options);
  } catch (error) {
    throw new Error("Nepodarilo sa pripojiť. Skontrolujte internetové pripojenie a skúste znova.");
  }

  return parseStorageResponse(response, path);
}

function dataUrlByteSize(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
}

function storedPhotoPayloadSize(dataUrl) {
  return JSON.stringify({ image: dataUrl }).length;
}

function detectPreferredImageMime() {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;

  if (canvas.toDataURL("image/webp").startsWith("data:image/webp")) {
    return "image/webp";
  }

  return "image/jpeg";
}

function resizeToDataUrl(file, maxSize, quality, mimeType = preferredImageMime) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = function () {
      const image = new Image();

      image.onload = function () {
        let width = image.width;
        let height = image.height;

        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = Math.round((height / width) * maxSize);
            width = maxSize;
          } else {
            width = Math.round((width / height) * maxSize);
            height = maxSize;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL(mimeType, quality));
      };

      image.onerror = () => reject(new Error("Nepodarilo sa načítať súbor s obrázkom."));
      image.src = reader.result;
    };

    reader.onerror = () => reject(new Error("Nepodarilo sa načítať súbor s obrázkom."));
    reader.readAsDataURL(file);
  });
}

async function compressImage(file) {
  let maxSize = 1600;

  while (maxSize >= 900) {
    let low = 0.55;
    let high = 0.95;
    let best = null;

    while (high - low > 0.025) {
      const quality = (low + high) / 2;
      const dataUrl = await resizeToDataUrl(file, maxSize, quality);

      if (
        dataUrlByteSize(dataUrl) <= MAX_IMAGE_BYTES &&
        storedPhotoPayloadSize(dataUrl) <= MAX_STORED_PHOTO_BYTES
      ) {
        best = dataUrl;
        low = quality;
      } else {
        high = quality;
      }
    }

    if (best) {
      return best;
    }

    maxSize -= 120;
  }

  throw new Error("Obrázok je príliš veľký. Vyberte menšiu fotografiu.");
}

async function loadPhotos() {
  const index = await storageRequest("/photos-index");
  const entries = Array.isArray(index) ? index : [];

  if (entries.length === 0) {
    photosCache = [];
    return photosCache;
  }

  const photos = await Promise.all(entries.map(async (entry) => {
    const stored = await storageRequest(`/photo-${entry.id}`);

    return {
      id: entry.id,
      name: entry.name,
      caption: entry.caption,
      image: stored?.image || ""
    };
  }));

  photosCache = photos.filter((photo) => photo.image);
  return photosCache;
}

async function loadReviews() {
  const reviews = await storageRequest("/reviews");
  reviewsCache = Array.isArray(reviews) ? reviews : [];
  return reviewsCache;
}

function getPhotos() {
  return photosCache;
}

function getReviews() {
  return reviewsCache;
}

async function savePhotoIndex(entries) {
  await storageRequest("/photos-index", "POST", entries);
}

async function saveReviews(reviews) {
  await storageRequest("/reviews", "POST", reviews);
  reviewsCache = reviews;
}

async function loadContact() {
  const contact = await storageRequest("/contact");

  if (contact && typeof contact === "object") {
    contactCache = {
      email: String(contact.email || DEFAULT_CONTACT.email).trim(),
      phone: String(contact.phone || "").trim()
    };
  } else {
    contactCache = { ...DEFAULT_CONTACT };
  }

  return contactCache;
}

function getContact() {
  return contactCache;
}

async function saveContact(contact) {
  const nextContact = {
    email: String(contact.email || "").trim(),
    phone: String(contact.phone || "").trim()
  };

  await storageRequest("/contact", "POST", nextContact);
  contactCache = nextContact;
}

function renderContactHtml(contact) {
  const lines = [];

  if (contact.email) {
    lines.push(`<p>E-mail: <a href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a></p>`);
  }

  if (contact.phone) {
    const phoneHref = contact.phone.replace(/[^\d+]/g, "");
    lines.push(`<p>Telefón: <a href="tel:${escapeHtml(phoneHref)}">${escapeHtml(contact.phone)}</a></p>`);
  }

  if (lines.length === 0) {
    return "<p>Kontaktné údaje sa čoskoro zobrazia.</p>";
  }

  return lines.join("");
}

async function displayContact() {
  const container = document.getElementById("contactInfo");
  if (!container) return;

  await loadContact();
  container.innerHTML = renderContactHtml(getContact());
}

async function loadContactForm() {
  const emailInput = document.getElementById("contactEmail");
  const phoneInput = document.getElementById("contactPhone");
  const preview = document.getElementById("contactPreview");
  if (!emailInput || !phoneInput) return;

  try {
    await loadContact();
    const contact = getContact();
    emailInput.value = contact.email;
    phoneInput.value = contact.phone;

    if (preview) {
      preview.innerHTML = renderContactHtml(contact);
    }
  } catch (error) {
    if (preview) {
      preview.textContent = "Kontaktné údaje sa zatiaľ nepodarilo načítať.";
    }
  }
}

async function saveContactInfo(event) {
  if (event) event.preventDefault();

  const email = document.getElementById("contactEmail").value.trim();
  const phone = document.getElementById("contactPhone").value.trim();
  const submitButton = event.target.querySelector("button[type='submit']");

  if (!email) {
    alert("Zadajte e-mailovú adresu.");
    return;
  }

  try {
    submitButton.disabled = true;
    submitButton.textContent = "Ukladá sa...";

    await saveContact({ email, phone });
    await loadContactForm();
    alert("Kontaktné údaje boli aktualizované. Skontrolujte sekciu Kontakt na hlavnej stránke.");
  } catch (error) {
    alert(error.message || "Nepodarilo sa uložiť kontaktné údaje.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Uložiť kontaktné údaje";
  }
}

function login(event) {
  if (event) event.preventDefault();

  const password = document.getElementById("password").value;

  if (password !== PASSWORD) {
    alert("Nesprávne heslo");
    return;
  }

  sessionStorage.setItem("admin", "true");
  window.location.href = "dashboard.html";
}

function logout() {
  sessionStorage.removeItem("admin");
  window.location.href = "admin.html";
}

async function addPhoto(event) {
  if (event) event.preventDefault();

  const name = document.getElementById("photoName").value.trim();
  const caption = document.getElementById("photoCaption").value.trim();
  const file = document.getElementById("photoImage").files[0];
  const submitButton = event.target.querySelector("button[type='submit']");

  if (!name || !caption || !file) {
    alert("Vyplňte všetky polia fotografie.");
    return;
  }

  try {
    submitButton.disabled = true;
    submitButton.textContent = "Nahráva sa...";

    const image = await compressImage(file);
    const id = Date.now().toString();
    const index = await storageRequest("/photos-index") || [];

    await storageRequest(`/photo-${id}`, "POST", { image });

    index.unshift({ id, name, caption });
    await savePhotoIndex(index);

    await loadPhotos();
    document.getElementById("photoForm").reset();
    await displayDashboardPhotos();
    alert("Fotografia bola nahraná. Teraz ju uvidia všetci.");
  } catch (error) {
    alert(error.message || "Nepodarilo sa nahrať fotografiu.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Nahrať fotografiu";
  }
}

async function deletePhoto(index) {
  try {
    const photo = getPhotos()[index];
    if (!photo) return;

    const remainingIndex = (await storageRequest("/photos-index") || []).filter((entry) => entry.id !== photo.id);
    await savePhotoIndex(remainingIndex);
    await storageRequest(`/photo-${photo.id}`, "DELETE");
    await loadPhotos();
    await displayDashboardPhotos();
  } catch (error) {
    alert(error.message || "Nepodarilo sa odstrániť fotografiu.");
  }
}

async function displayDashboardPhotos() {
  const galleryList = document.getElementById("galleryList");
  if (!galleryList) return;

  galleryList.innerHTML = "<p>Načítavajú sa fotografie...</p>";

  await loadPhotos();
  const photos = getPhotos();

  if (photos.length === 0) {
    galleryList.innerHTML = "<p>Zatiaľ neboli nahrané žiadne fotografie.</p>";
    return;
  }

  galleryList.innerHTML = photos.map((photo, index) => `
    <div class="photo-item">
      <div>
        <strong>${escapeHtml(photo.name)}</strong>
        <br>
        ${escapeHtml(photo.caption)}
      </div>
      <button class="delete-button" type="button" onclick="deletePhoto(${index})">Odstrániť</button>
    </div>
  `).join("");
}

async function displayGallery(keepVisibleCount = false) {
  const gallery = document.getElementById("galleryGrid") || document.getElementById("gallery");
  if (!gallery) return;

  const paginate = gallery.id === "galleryGrid";

  if (!keepVisibleCount) {
    galleryVisibleCount = GALLERY_INITIAL_COUNT;
  }

  gallery.innerHTML = '<div class="empty">Načítava sa galéria...</div>';

  await loadPhotos();
  const photos = getPhotos();

  if (photos.length === 0) {
    gallery.innerHTML = '<div class="empty">Zatiaľ neboli nahrané žiadne fotografie.</div>';
    updateGalleryControls(0, 0);
    return;
  }

  const visibleCount = paginate ? Math.min(galleryVisibleCount, photos.length) : photos.length;

  gallery.innerHTML = photos.slice(0, visibleCount).map((photo, index) => `
    <article class="photo-card">
      <img src="${photo.image}" alt="${escapeHtml(photo.name)}" onclick="openImage(${index})">
      <div class="photo-info">
        <h3>${escapeHtml(photo.name)}</h3>
        <p>${escapeHtml(photo.caption)}</p>
      </div>
    </article>
  `).join("");

  if (paginate) {
    updateGalleryControls(photos.length, visibleCount);
  } else {
    updateGalleryControls(0, 0);
  }
}

function updateGalleryControls(totalPhotos, visibleCount) {
  const wrap = document.getElementById("galleryMoreWrap");
  const moreBtn = document.getElementById("galleryMoreBtn");
  const lessBtn = document.getElementById("galleryLessBtn");
  if (!wrap || !moreBtn || !lessBtn) return;

  const showMore = totalPhotos > GALLERY_INITIAL_COUNT && visibleCount < totalPhotos;
  const showLess = totalPhotos > GALLERY_INITIAL_COUNT && visibleCount > GALLERY_INITIAL_COUNT;

  wrap.style.display = showMore || showLess ? "flex" : "none";
  moreBtn.style.display = showMore ? "flex" : "none";
  lessBtn.style.display = showLess ? "flex" : "none";
}

function loadMoreGallery() {
  galleryVisibleCount += GALLERY_BATCH_SIZE;
  displayGallery(true);
}

function loadLessGallery() {
  galleryVisibleCount = GALLERY_INITIAL_COUNT;
  displayGallery(true);

  const gallerySection = document.getElementById("gallery");
  if (gallerySection) {
    gallerySection.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

window.loadMoreGallery = loadMoreGallery;
window.loadLessGallery = loadLessGallery;

function openImage(indexOrSrc) {
  const photos = getPhotos();
  const src = typeof indexOrSrc === "number" ? photos[indexOrSrc]?.image : indexOrSrc;
  if (!src) return;

  const lightbox = document.getElementById("lightbox");
  const lightboxImage = document.getElementById("lightboxImage");
  if (!lightbox || !lightboxImage) return;

  currentLightboxIndex = typeof indexOrSrc === "number" ? indexOrSrc : null;
  lightbox.style.display = "flex";
  lightboxImage.src = src;
}

function closeImage() {
  const lightbox = document.getElementById("lightbox");
  currentLightboxIndex = null;
  if (lightbox) lightbox.style.display = "none";
}

async function displayPublicReviews() {
  const container = document.getElementById("reviewsList") || document.getElementById("reviews");
  if (!container) return;

  await loadReviews();
  const reviews = getReviews();
  const admin = isAdmin();

  if (reviews.length === 0) {
    container.innerHTML = '<div class="empty">Zatiaľ žiadne recenzie. Buďte prvý, kto sa podelí o svoju skúsenosť!</div>';
    return;
  }

  container.innerHTML = reviews.map((review, index) => `
    <article class="review">
      <h3>${escapeHtml(review.name)}</h3>
      <div class="stars">${escapeHtml(review.rating)}</div>
      <p>${escapeHtml(review.message)}</p>
      ${review.reply ? `
        <div class="review-reply">
          <strong>Odpoveď Jaroslavy Forro</strong>
          <p>${escapeHtml(review.reply)}</p>
        </div>
      ` : ""}
      ${admin ? `<div class="review-actions"><button class="delete-button" type="button" onclick="deletePublicReview(${index})">Odstrániť</button></div>` : ""}
    </article>
  `).join("");
}

async function submitPublicReview(event) {
  if (event) event.preventDefault();

  const name = document.getElementById("name").value.trim();
  const rating = document.getElementById("rating").value;
  const message = document.getElementById("message").value.trim();
  const submitButton = event.target.querySelector("button[type='submit']");

  if (!name || !message) {
    alert("Vyplňte všetky polia.");
    return;
  }

  try {
    submitButton.disabled = true;
    submitButton.textContent = "Odosiela sa...";

    const reviews = [...getReviews()];
    reviews.unshift({ name, rating, message });
    await saveReviews(reviews);

    await displayPublicReviews();
    event.target.reset();
    alert("Ďakujeme za vašu recenziu!");
  } catch (error) {
    alert(error.message || "Nepodarilo sa odoslať recenziu.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Odoslať recenziu";
  }
}

async function deletePublicReview(index) {
  if (!isAdmin()) return;

  try {
    const reviews = [...getReviews()];
    reviews.splice(index, 1);
    await saveReviews(reviews);
    await displayPublicReviews();
    await displayDashboardReviews();
  } catch (error) {
    alert(error.message || "Nepodarilo sa odstrániť recenziu.");
  }
}

async function addReview(event) {
  if (event) event.preventDefault();

  const name = document.getElementById("reviewName").value.trim();
  const rating = document.getElementById("reviewRating").value;
  const message = document.getElementById("reviewMessage").value.trim();

  if (!name || !message) {
    alert("Vyplňte všetky polia recenzie.");
    return;
  }

  try {
    const reviews = [...getReviews()];
    reviews.unshift({ name, rating, message });
    await saveReviews(reviews);

    document.getElementById("reviewForm").reset();
    await displayDashboardReviews();
    alert("Recenzia bola pridaná.");
  } catch (error) {
    alert(error.message || "Nepodarilo sa pridať recenziu.");
  }
}

async function deleteReview(index) {
  try {
    const reviews = [...getReviews()];
    reviews.splice(index, 1);
    await saveReviews(reviews);
    await displayDashboardReviews();
  } catch (error) {
    alert(error.message || "Nepodarilo sa odstrániť recenziu.");
  }
}

async function saveReviewReply(index) {
  if (!isAdmin()) return;

  const textarea = document.getElementById(`review-reply-${index}`);
  if (!textarea) return;

  const reply = textarea.value.trim();
  const saveButton = textarea.parentElement.querySelector(".save-reply-button");

  try {
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Ukladá sa...";
    }

    await loadReviews();
    const reviews = [...getReviews()];
    if (!reviews[index]) return;

    reviews[index] = { ...reviews[index], reply };
    await saveReviews(reviews);
    await displayDashboardReviews();
    alert("Odpoveď bola uložená a zobrazí sa na webe.");
  } catch (error) {
    alert(error.message || "Nepodarilo sa uložiť odpoveď.");
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = "Uložiť odpoveď";
    }
  }
}

async function displayDashboardReviews() {
  const reviewList = document.getElementById("reviewList");
  if (!reviewList) return;

  await loadReviews();
  const reviews = getReviews();

  if (reviews.length === 0) {
    reviewList.innerHTML = "<p>Zatiaľ žiadne recenzie.</p>";
    return;
  }

  reviewList.innerHTML = reviews.map((review, index) => `
    <div class="review-item review-item-admin" data-review-index="${index}">
      <div class="review-item-body">
        <span class="review-label">Recenzia od zákazníka</span>
        <strong>${escapeHtml(review.name)}</strong>
        <span class="stars">${escapeHtml(review.rating)}</span>
        <p>${escapeHtml(review.message)}</p>
      </div>
      <div class="review-reply-form">
        <label for="review-reply-${index}">Vaša odpoveď (zobrazí sa pod recenziou na webe)</label>
        <textarea id="review-reply-${index}" placeholder="Napíšte odpoveď..."></textarea>
        <div class="review-item-actions">
          <button class="save-reply-button" type="button" data-action="save-reply">Uložiť odpoveď</button>
          <button class="delete-button" type="button" onclick="deleteReview(${index})">Odstrániť recenziu</button>
        </div>
        ${review.reply ? `<p class="review-reply-status">Aktuálna odpoveď na webe: „${escapeHtml(review.reply)}”</p>` : `<p class="review-reply-status review-reply-status-empty">Zatiaľ bez odpovede</p>`}
      </div>
    </div>
  `).join("");

  reviews.forEach((review, index) => {
    const textarea = document.getElementById(`review-reply-${index}`);
    if (textarea) {
      textarea.value = review.reply || "";
    }
  });
}

window.saveReviewReply = saveReviewReply;

document.addEventListener("DOMContentLoaded", function () {
  preferredImageMime = detectPreferredImageMime();

  document.querySelectorAll(".download-button, .lightbox-download, #lightboxDownload").forEach(function (button) {
    button.remove();
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (registrations) {
      registrations.forEach(function (registration) {
        registration.unregister();
      });
    });
  }

  if (document.getElementById("galleryList")) {
    displayDashboardPhotos();
  }

  if (document.getElementById("reviewList")) {
    displayDashboardReviews();
  }

  if (document.getElementById("contactForm")) {
    loadContactForm();
  }
});
