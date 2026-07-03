const PASSWORD = "Jaroslava2025";
const MANTLE_BASE = `https://mantledb.sh/v2/${STORAGE_CONFIG.mantleNamespace}`;
const MANTLE_KEY = STORAGE_CONFIG.mantleKey;
const MAX_IMAGE_BYTES = 45000;

const DEFAULT_CONTACT = {
  email: "info@jaroslavaforro.com",
  phone: ""
};

let photosCache = [];
let reviewsCache = [];
let contactCache = { ...DEFAULT_CONTACT };
let currentLightboxIndex = null;

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

async function parseStorageResponse(response) {
  if (response.status === 404) {
    return null;
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error("Could not save photo. Try a smaller image.");
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
    throw new Error("Could not connect. Check your internet and try again.");
  }

  return parseStorageResponse(response);
}

function dataUrlByteSize(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
}

function resizeToDataUrl(file, maxSize, quality) {
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
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };

      image.onerror = () => reject(new Error("Could not read image file."));
      image.src = reader.result;
    };

    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });
}

async function compressImage(file) {
  let quality = 0.8;
  let maxSize = 1000;

  while (quality >= 0.35) {
    const dataUrl = await resizeToDataUrl(file, maxSize, quality);

    if (dataUrlByteSize(dataUrl) <= MAX_IMAGE_BYTES) {
      return dataUrl;
    }

    quality -= 0.08;
    maxSize -= 100;
  }

  throw new Error("Image is too large. Please choose a smaller photo.");
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
    lines.push(`<p>Email: <a href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a></p>`);
  }

  if (contact.phone) {
    const phoneHref = contact.phone.replace(/[^\d+]/g, "");
    lines.push(`<p>Phone: <a href="tel:${escapeHtml(phoneHref)}">${escapeHtml(contact.phone)}</a></p>`);
  }

  if (lines.length === 0) {
    return "<p>Contact details will appear here soon.</p>";
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
  if (!emailInput || !phoneInput) return;

  await loadContact();
  const contact = getContact();
  emailInput.value = contact.email;
  phoneInput.value = contact.phone;
}

async function saveContactInfo(event) {
  if (event) event.preventDefault();

  const email = document.getElementById("contactEmail").value.trim();
  const phone = document.getElementById("contactPhone").value.trim();
  const submitButton = event.target.querySelector("button[type='submit']");

  if (!email) {
    alert("Please enter an email address.");
    return;
  }

  try {
    submitButton.disabled = true;
    submitButton.textContent = "Saving...";

    await saveContact({ email, phone });
    alert("Contact info updated.");
  } catch (error) {
    alert(error.message || "Could not save contact info.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Save Contact Info";
  }
}

function login(event) {
  if (event) event.preventDefault();

  const password = document.getElementById("password").value;

  if (password !== PASSWORD) {
    alert("Wrong password");
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
    alert("Please complete all photo fields.");
    return;
  }

  try {
    submitButton.disabled = true;
    submitButton.textContent = "Uploading...";

    const image = await compressImage(file);
    const id = Date.now().toString();
    const index = await storageRequest("/photos-index") || [];

    await storageRequest(`/photo-${id}`, "POST", { image });

    index.unshift({ id, name, caption });
    await savePhotoIndex(index);

    await loadPhotos();
    document.getElementById("photoForm").reset();
    await displayDashboardPhotos();
    alert("Photo uploaded. Everyone can see it now.");
  } catch (error) {
    alert(error.message || "Could not upload photo.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Upload Photo";
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
    alert(error.message || "Could not delete photo.");
  }
}

async function displayDashboardPhotos() {
  const galleryList = document.getElementById("galleryList");
  if (!galleryList) return;

  galleryList.innerHTML = "<p>Loading photos...</p>";

  await loadPhotos();
  const photos = getPhotos();

  if (photos.length === 0) {
    galleryList.innerHTML = "<p>No photos uploaded yet.</p>";
    return;
  }

  galleryList.innerHTML = photos.map((photo, index) => `
    <div class="photo-item">
      <div>
        <strong>${escapeHtml(photo.name)}</strong>
        <br>
        ${escapeHtml(photo.caption)}
      </div>
      <button class="delete-button" type="button" onclick="deletePhoto(${index})">Delete</button>
    </div>
  `).join("");
}

async function displayGallery() {
  const gallery = document.getElementById("galleryGrid") || document.getElementById("gallery");
  if (!gallery) return;

  gallery.innerHTML = '<div class="empty">Loading gallery...</div>';

  await loadPhotos();
  const photos = getPhotos();

  if (photos.length === 0) {
    gallery.innerHTML = '<div class="empty">No photos have been uploaded yet.</div>';
    return;
  }

  gallery.innerHTML = photos.map((photo, index) => `
    <article class="photo-card">
      <img src="${photo.image}" alt="${escapeHtml(photo.name)}" onclick="openImage(${index})">
      <div class="photo-info">
        <h3>${escapeHtml(photo.name)}</h3>
        <p>${escapeHtml(photo.caption)}</p>
      </div>
    </article>
  `).join("");
}

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
    container.innerHTML = '<div class="empty">No reviews yet. Be the first to share your experience!</div>';
    return;
  }

  container.innerHTML = reviews.map((review, index) => `
    <article class="review">
      <h3>${escapeHtml(review.name)}</h3>
      <div class="stars">${escapeHtml(review.rating)}</div>
      <p>${escapeHtml(review.message)}</p>
      ${admin ? `<div class="review-actions"><button class="delete-button" type="button" onclick="deletePublicReview(${index})">Remove</button></div>` : ""}
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
    alert("Please fill in all fields.");
    return;
  }

  try {
    submitButton.disabled = true;
    submitButton.textContent = "Submitting...";

    const reviews = [...getReviews()];
    reviews.unshift({ name, rating, message });
    await saveReviews(reviews);

    await displayPublicReviews();
    event.target.reset();
    alert("Thank you for your review!");
  } catch (error) {
    alert(error.message || "Could not submit review.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Submit Review";
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
    alert(error.message || "Could not remove review.");
  }
}

async function addReview(event) {
  if (event) event.preventDefault();

  const name = document.getElementById("reviewName").value.trim();
  const rating = document.getElementById("reviewRating").value;
  const message = document.getElementById("reviewMessage").value.trim();

  if (!name || !message) {
    alert("Please complete all review fields.");
    return;
  }

  try {
    const reviews = [...getReviews()];
    reviews.unshift({ name, rating, message });
    await saveReviews(reviews);

    document.getElementById("reviewForm").reset();
    await displayDashboardReviews();
    alert("Review added.");
  } catch (error) {
    alert(error.message || "Could not add review.");
  }
}

async function deleteReview(index) {
  try {
    const reviews = [...getReviews()];
    reviews.splice(index, 1);
    await saveReviews(reviews);
    await displayDashboardReviews();
  } catch (error) {
    alert(error.message || "Could not delete review.");
  }
}

async function displayDashboardReviews() {
  const reviewList = document.getElementById("reviewList");
  if (!reviewList) return;

  await loadReviews();
  const reviews = getReviews();

  if (reviews.length === 0) {
    reviewList.innerHTML = "<p>No reviews yet.</p>";
    return;
  }

  reviewList.innerHTML = reviews.map((review, index) => `
    <div class="review-item">
      <div>
        <strong>${escapeHtml(review.name)}</strong>
        <br>
        <span class="stars">${escapeHtml(review.rating)}</span>
        <p>${escapeHtml(review.message)}</p>
      </div>
      <button class="delete-button" type="button" onclick="deleteReview(${index})">Delete</button>
    </div>
  `).join("");
}

document.addEventListener("DOMContentLoaded", function () {
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
