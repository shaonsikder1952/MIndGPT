document.addEventListener("DOMContentLoaded", () => {
  // — Sidebar toggle (unchanged) —
  const menuToggle = document.getElementById("menuToggle");
  const sidebar    = document.getElementById("sidebar");
  menuToggle.addEventListener("click", () => {
    sidebar.classList.toggle("hidden");
  });

  // — Figure out which page we’re on and pick the right category key —
  //   /files/images    → "image"
  //   /files/audio     → "audio"
  //   /files/video     → "video"
  //   /files/documents → "text"
  //   any other /files → show nothing (all-files.html is server-rendered)
  let categoryKey = null;
  const p = window.location.pathname;
  if (p.startsWith("/files/images"))    categoryKey = "image";
  else if (p.startsWith("/files/audio"))   categoryKey = "audio";
  else if (p.startsWith("/files/video"))   categoryKey = "video";
  else if (p.startsWith("/files/documents")) categoryKey = "text";

  // — Load the gallery if we have a category —
  const gallery = document.getElementById("fileGallery");
  if (gallery && categoryKey) {
    fetch(`/get_files/${categoryKey}`)
      .then(r => r.json())
      .then(files => {
        gallery.innerHTML = "";
        files.forEach(f => {
          const ext = f.name.split(".").pop().toLowerCase();
          let el;
          if (["jpg","jpeg","png","gif","bmp","webp"].includes(ext)) {
            el = document.createElement("img");
            el.src = f.path;
          } else if (["mp4","avi","mov","mkv","webm"].includes(ext)) {
            el = document.createElement("video");
            el.src = f.path;
            el.controls = true;
          } else {
            el = document.createElement("a");
            el.href = f.path;
            el.textContent = f.name;
          }
          el.classList.add("gallery-item");
          gallery.appendChild(el);
        });
      })
      .catch(err => console.error("Failed to load files:", err));
  }

  // — AJAX file upload to your existing `/upload` route —
  const form  = document.getElementById("uploadForm");
  const input = document.getElementById("fileInput");
  if (form && input) {
    form.addEventListener("submit", async e => {
      e.preventDefault();
      if (!input.files.length) return;

      const fd = new FormData();
      // your Flask expects `file` as the field name
      fd.append("file", input.files[0]);

      try {
        const res  = await fetch(form.action, {
          method: form.method.toUpperCase(), // should be POST
          body:   fd,
          credentials: "include"
        });
        const json = await res.json();
        showToast(json.message || json.error || "Upload complete");
        input.value = "";  // reset the picker

        // reload the gallery if on a category page
        if (gallery && categoryKey) {
          // simply re-run the same fetch logic
          const evt = new Event("DOMContentLoaded");
          document.dispatchEvent(evt);
        }
      } catch (err) {
        console.error("Upload failed:", err);
        showToast("Upload error");
      }
    });
  }

  // — tiny toast helper —
  function showToast(msg) {
    const t = document.createElement("div");
    t.textContent = msg;
    Object.assign(t.style, {
      position:     "fixed",
      bottom:       "20px",
      right:        "20px",
      background:   "#333",
      color:        "#fff",
      padding:      "12px 20px",
      borderRadius: "6px",
      opacity:      0,
      transition:   "opacity 0.3s",
      zIndex:       9999
    });
    document.body.appendChild(t);
    requestAnimationFrame(() => t.style.opacity = 1);
    setTimeout(() => {
      t.style.opacity = 0;
      setTimeout(() => t.remove(), 300);
    }, 3000);
  }
});
