(() => {
  // ── DOM refs ──
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const fileListArea = document.getElementById("fileListArea");
  const fileList = document.getElementById("fileList");
  const fileCount = document.getElementById("fileCount");
  const convertBtn = document.getElementById("convertBtn");
  const resolution = document.getElementById("resolution");
  const modeSelect = document.getElementById("mode");
  const modeHint = document.getElementById("modeHint");
  const globalProgress = document.getElementById("globalProgress");
  const gpFill = document.getElementById("gpFill");
  const gpText = document.getElementById("gpText");
  const toast = document.getElementById("toast");
  const toastMsg = document.getElementById("toastMsg");
  const toastIcon = document.getElementById("toastIcon");
  const statusDot = document.getElementById("statusDot");
  const statusLabel = document.getElementById("statusLabel");
  const clearFilesBtn = document.getElementById("clearFilesBtn");
  const startOverBtn = document.getElementById("startOverBtn");

  const MODE_HINTS = {
    screenshot: "Each slide becomes a high-res image — pixel-perfect fidelity, not editable in PowerPoint.",
    editable: "DOM elements are extracted as native PowerPoint objects — text and shapes are fully editable.",
  };

  function updateModeHint() {
    modeHint.textContent = MODE_HINTS[modeSelect.value] || "";
  }
  modeSelect.addEventListener("change", updateModeHint);
  updateModeHint();

  // ── Server health check & mode detection ──
  let serverOnline = false;

  async function checkHealth() {
    try {
      const resp = await fetch("/api/health");
      if (resp.ok) {
        serverOnline = true;
        statusDot.classList.remove("offline");
        statusDot.classList.remove("client");
        statusLabel.textContent = "Server mode";
      } else { throw new Error(); }
    } catch {
      serverOnline = false;
      statusDot.classList.add("offline");
      statusDot.classList.add("client");
      statusLabel.textContent = "Client mode";
    }
  }
  checkHealth();
  setInterval(checkHealth, 30000);

  /** @type {File[]} */
  let selectedFiles = [];

  // ── Drop zone interactions ──
  dropZone.addEventListener("click", () => fileInput.click());

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    addFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener("change", () => {
    addFiles(fileInput.files);
    fileInput.value = "";
  });

  function addFiles(fileListInput) {
    for (const file of fileListInput) {
      const ext = file.name.split(".").pop().toLowerCase();
      if (ext === "html" || ext === "htm") {
        if (!selectedFiles.some((f) => f.name === file.name)) {
          selectedFiles.push(file);
        }
      }
    }
    renderFileList();
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  function renderFileList() {
    fileList.innerHTML = "";

    const sorted = [...selectedFiles].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    );
    // Rebuild selectedFiles in sorted order for index consistency
    selectedFiles = sorted;

    sorted.forEach((file, idx) => {
      const li = document.createElement("li");
      li.className = "file-item";
      li.dataset.idx = idx;
      li.innerHTML = `
        <div class="file-progress"></div>
        <div class="file-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>
        </div>
        <div class="file-info">
          <div class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
          <div class="file-meta">${formatSize(file.size)}</div>
        </div>
        <span class="file-status queued">Queued</span>
        <button class="file-remove" data-idx="${idx}" title="Remove file">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      `;
      fileList.appendChild(li);
    });

    const count = selectedFiles.length;
    fileCount.textContent = count + (count === 1 ? " file" : " files");
    fileListArea.classList.toggle("has-files", count > 0);
    fileListArea.closest(".upload-row").classList.toggle("has-files", count > 0);
    convertBtn.disabled = count === 0;
    hideToast();
  }

  fileList.addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".file-remove");
    if (removeBtn) {
      const idx = parseInt(removeBtn.dataset.idx, 10);
      selectedFiles.splice(idx, 1);
      renderFileList();
    }
  });

  // ── Per-file status helpers ──
  function setFileStatus(idx, state, label) {
    const li = fileList.querySelector(`[data-idx="${idx}"]`);
    if (!li) return;
    li.className = "file-item " + state;
    const badge = li.querySelector(".file-status");
    badge.className = "file-status " + state;
    badge.textContent = label || state;
  }

  function setFileProgress(idx, pct) {
    const li = fileList.querySelector(`[data-idx="${idx}"]`);
    if (!li) return;
    const bar = li.querySelector(".file-progress");
    bar.style.width = pct + "%";
  }

  // ── Convert button ──
  convertBtn.addEventListener("click", async () => {
    if (selectedFiles.length === 0) return;

    const totalFiles = selectedFiles.length;
    convertBtn.disabled = true;
    convertBtn.classList.add("loading");
    const loadingText = convertBtn.querySelector(".btn-loading-text");
    loadingText.style.display = "inline";

    // Mark all files as queued
    for (let i = 0; i < totalFiles; i++) {
      setFileStatus(i, "queued", "Queued");
      setFileProgress(i, 0);
    }

    try {
      if (serverOnline) {
        await convertViaServer(totalFiles, loadingText);
      } else {
        await convertClientSide(totalFiles, loadingText);
      }
    } catch (err) {
      for (let i = 0; i < totalFiles; i++) {
        const li = fileList.querySelector(`[data-idx="${i}"]`);
        if (li && !li.classList.contains("done")) {
          setFileStatus(i, "error", "Failed");
        }
      }
      showToast(err.message || "Conversion failed", "error");
    } finally {
      hideGlobalProgress();
      convertBtn.classList.remove("loading");
      loadingText.style.display = "none";
      convertBtn.disabled = selectedFiles.length === 0;
    }
  });

  // ── Server-side conversion ──
  async function convertViaServer(totalFiles, loadingText) {
    showGlobalProgress("Uploading files…", 5);

    for (let i = 0; i < totalFiles; i++) {
      setFileStatus(i, "uploading", "Uploading");
      setFileProgress(i, 20);
    }

    const formData = new FormData();
    for (const file of selectedFiles) {
      formData.append("htmlFiles", file);
    }
    formData.append("resolution", resolution.value);
    formData.append("mode", modeSelect.value);

    showGlobalProgress("Uploading to server…", 15);

    let currentFileIdx = 0;
    const progressInterval = setInterval(() => {
      if (currentFileIdx < totalFiles) {
        if (currentFileIdx > 0) {
          setFileStatus(currentFileIdx - 1, "done", "Done");
          setFileProgress(currentFileIdx - 1, 100);
        }
        setFileStatus(currentFileIdx, "processing", "Processing");
        setFileProgress(currentFileIdx, 60);

        const pct = 20 + Math.round((currentFileIdx / totalFiles) * 60);
        showGlobalProgress(`Processing slide ${currentFileIdx + 1} of ${totalFiles}…`, pct);

        currentFileIdx++;
      }
    }, Math.max(800, 2500 / totalFiles));

    const resp = await fetch("/api/convert", {
      method: "POST",
      body: formData,
    });

    clearInterval(progressInterval);

    if (!resp.ok) {
      const json = await resp.json().catch(() => ({}));
      throw new Error(json.error || `Server error ${resp.status}`);
    }

    for (let i = 0; i < totalFiles; i++) {
      setFileStatus(i, "done", "Done");
      setFileProgress(i, 100);
    }

    showGlobalProgress("Generating download…", 90);

    const blob = await resp.blob();

    showGlobalProgress("Complete!", 100);
    triggerDownload(blob);
    showToast("Presentation downloaded successfully!", "success");
  }

  // ── Client-side conversion ──
  async function convertClientSide(totalFiles, loadingText) {
    if (typeof ClientConverter === "undefined") {
      throw new Error("Client converter not loaded");
    }

    showGlobalProgress("Converting in browser…", 5);

    const blob = await ClientConverter.convert(
      [...selectedFiles],
      { resolution: resolution.value, mode: modeSelect.value },
      (fileIdx, total, message) => {
        // Mark previous files as done
        for (let j = 0; j < fileIdx; j++) {
          setFileStatus(j, "done", "Done");
          setFileProgress(j, 100);
        }
        if (fileIdx < total) {
          setFileStatus(fileIdx, "processing", "Processing");
          setFileProgress(fileIdx, 50);
        }
        const pct = 5 + Math.round((fileIdx / total) * 85);
        showGlobalProgress(message, pct);
      }
    );

    for (let i = 0; i < totalFiles; i++) {
      setFileStatus(i, "done", "Done");
      setFileProgress(i, 100);
    }

    showGlobalProgress("Complete!", 100);
    triggerDownload(blob);
    showToast("Presentation downloaded successfully!", "success");
  }

  // ── Download helper ──
  function triggerDownload(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "presentation.pptx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ── Global progress helpers ──
  function showGlobalProgress(text, pct) {
    globalProgress.classList.add("visible");
    gpFill.style.width = pct + "%";
    gpText.textContent = text;
  }

  function hideGlobalProgress() {
    setTimeout(() => {
      globalProgress.classList.remove("visible");
      gpFill.style.width = "0%";
    }, 1500);
  }

  // ── Toast helpers ──
  let toastTimer = null;
  function showToast(msg, type) {
    clearTimeout(toastTimer);
    toast.className = "toast visible " + type;
    toastMsg.textContent = msg;

    if (type === "success") {
      toastIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>';
    } else {
      toastIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z"/>';
    }

    toastTimer = setTimeout(() => {
      toast.classList.remove("visible");
    }, 5000);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    toast.classList.remove("visible");
  }

  // ── Clear files button ──
  clearFilesBtn.addEventListener("click", () => {
    selectedFiles = [];
    renderFileList();
  });

  // ── Start over button ──
  startOverBtn.addEventListener("click", () => {
    selectedFiles = [];
    renderFileList();
    resolution.value = "720p";
    modeSelect.value = "editable";
    updateModeHint();
    hideGlobalProgress();
    hideToast();
    // Reset any processing/done/error states
    convertBtn.classList.remove("loading");
    const loadingText = convertBtn.querySelector(".btn-loading-text");
    if (loadingText) loadingText.style.display = "none";
  });

  // ── Util ──
  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }
})();
