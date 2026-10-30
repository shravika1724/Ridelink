/**
 * RideLink - Vehicle Photo Upload Controller
 * Handles drag-and-drop, file browsing, previews, and base64 encoding
 * for the "List Your Vehicle" modal.
 */

const VehicleUpload = (() => {
  const MAX_PHOTOS  = 5;
  const MAX_BYTES   = 5 * 1024 * 1024; // 5 MB per file
  const ALLOWED     = ["image/jpeg", "image/png", "image/webp", "image/gif"];

  let _photos = []; // Array of { dataUrl, name }

  const el = id => document.getElementById(id);

  function _countLabel() {
    const lbl = el("v-photo-count-label");
    if (!lbl) return;
    lbl.textContent = _photos.length === 0
      ? "No photos selected - a default image will be used."
      : `${_photos.length} photo${_photos.length > 1 ? "s" : ""} selected`;
    lbl.style.color = _photos.length > 0 ? "var(--accent-emerald)" : "var(--text-dim)";
  }

  function _renderPreviews() {
    const grid = el("v-photo-preview-grid");
    if (!grid) return;

    grid.innerHTML = _photos.map((p, i) => `
      <div id="vup-thumb-${i}" style="
        position:relative;width:90px;height:68px;
        border-radius:10px;overflow:hidden;
        border:2px solid rgba(6,182,212,0.3);
        box-shadow:0 4px 14px rgba(0,0,0,0.35);flex-shrink:0;">
        <img src="${p.dataUrl}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;display:block;">
        ${i === 0 ? `<span style="position:absolute;bottom:3px;left:4px;font-size:.6rem;font-weight:700;background:var(--accent-emerald);color:#fff;padding:1px 5px;border-radius:4px;letter-spacing:.5px;">COVER</span>` : ""}
        <button type="button" onclick="VehicleUpload.removePhoto(${i})" title="Remove"
          style="position:absolute;top:3px;right:3px;width:20px;height:20px;border-radius:50%;border:none;background:rgba(239,68,68,0.85);color:#fff;cursor:pointer;font-size:.7rem;display:flex;align-items:center;justify-content:center;"
          onmouseenter="this.style.background='rgba(220,38,38,1)'"
          onmouseleave="this.style.background='rgba(239,68,68,0.85)'">&times;</button>
      </div>
    `).join("");

    _countLabel();
  }

  function _readFiles(files) {
    const remaining = MAX_PHOTOS - _photos.length;
    if (remaining <= 0) {
      showToast("Maximum " + MAX_PHOTOS + " photos allowed.", "warning");
      return;
    }
    const toRead = Array.from(files).slice(0, remaining);
    const errors = [];

    toRead.forEach(file => {
      if (!ALLOWED.includes(file.type)) { errors.push('"' + file.name + '" unsupported format.'); return; }
      if (file.size > MAX_BYTES) { errors.push('"' + file.name + '" exceeds 5 MB.'); return; }
      const reader = new FileReader();
      reader.onload = e => { _photos.push({ dataUrl: e.target.result, name: file.name }); _renderPreviews(); };
      reader.readAsDataURL(file);
    });

    if (errors.length) showToast(errors.join(" "), "error");
    if (files.length > remaining) showToast("Only " + remaining + " more photo(s) can be added (max " + MAX_PHOTOS + ").", "warning");
  }

  function onDragOver(e) {
    e.preventDefault();
    const z = el("v-photo-dropzone");
    if (z) { z.style.borderColor = "var(--accent-cyan)"; z.style.background = "rgba(6,182,212,0.10)"; }
  }

  function onDragLeave(e) {
    const z = el("v-photo-dropzone");
    if (z) { z.style.borderColor = "rgba(6,182,212,0.45)"; z.style.background = "rgba(6,182,212,0.04)"; }
  }

  function onDrop(e) {
    e.preventDefault();
    onDragLeave(e);
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) _readFiles(files);
  }

  function onFilesSelected(e) {
    _readFiles(e.target.files);
    e.target.value = "";
  }

  function removePhoto(index) {
    _photos.splice(index, 1);
    _renderPreviews();
  }

  function getPhotoDataUrls() {
    return _photos.map(p => p.dataUrl);
  }

  function reset() {
    _photos = [];
    _renderPreviews();
    const inp = el("v-photo-input");
    if (inp) inp.value = "";
  }

  return { onDragOver, onDragLeave, onDrop, onFilesSelected, removePhoto, getPhotoDataUrls, reset };
})();

window.VehicleUpload = VehicleUpload;
