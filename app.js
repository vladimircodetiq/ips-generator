(function () {
  const TEMPLATES_KEY = "ips.templates";
  const PAYER_KEY = "ips.payer";
  const TEMPLATE_FIELDS = ["account", "name", "amount", "code", "model", "reference", "purpose"];

  qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];

  const form = document.getElementById("form");
  const errorBox = document.getElementById("error");
  const templateSelect = document.getElementById("template");
  const deleteTemplateButton = document.getElementById("delete-template");
  const result = document.getElementById("result");
  const image = document.getElementById("qr-image");
  const downloadLink = document.getElementById("download");
  const shareButton = document.getElementById("share");
  const payloadView = document.getElementById("payload");

  let currentFile = null;
  let currentUrl = null;

  function readForm() {
    return Object.fromEntries(new FormData(form).entries());
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function formatAmount(amount) {
    const [integer, fraction] = amount.split(",");
    return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction}`;
  }

  function normalizedAmountOrEmpty(input) {
    try {
      return IPS.parseAmount(input);
    } catch {
      return "";
    }
  }

  function loadTemplates() {
    try {
      return JSON.parse(localStorage.getItem(TEMPLATES_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveTemplates(templates) {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  }

  function renderTemplateOptions(selectedId) {
    templateSelect.length = 1;
    for (const t of loadTemplates()) {
      templateSelect.add(new Option(t.label, t.id, false, t.id === selectedId));
    }
    deleteTemplateButton.disabled = !templateSelect.value;
  }

  function applyTemplate(id) {
    const template = loadTemplates().find((t) => t.id === id);
    if (!template) return;
    clearFieldMarks();
    for (const field of TEMPLATE_FIELDS) form.elements[field].value = template[field] || "";
    form.elements.amount.value = template.amount ? formatAmount(template.amount) : "";
    result.hidden = true;
    if (!template.amount) form.elements.amount.focus();
  }

  function saveCurrentAsTemplate() {
    const data = readForm();
    try {
      data.account = IPS.formatAccount(IPS.normalizeAccount(data.account));
    } catch (e) {
      showError(e.message);
      return;
    }
    if (!data.name.trim()) {
      showError("Payee name is required.");
      return;
    }
    showError("");
    data.amount = normalizedAmountOrEmpty(data.amount);
    const label = data.name.trim().split("\n")[0];
    const templates = loadTemplates();
    const existing = templates.find((t) => t.account === data.account && t.label === label);
    const template = existing || { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, label };
    for (const field of TEMPLATE_FIELDS) template[field] = data[field] || "";
    if (!existing) templates.push(template);
    templates.sort((a, b) => a.label.localeCompare(b.label, "sr"));
    saveTemplates(templates);
    renderTemplateOptions(template.id);
  }

  function wrapText(ctx, text, maxWidth) {
    const lines = [];
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const word of paragraph.split(" ")) {
        const candidate = line ? `${line} ${word}` : word;
        if (ctx.measureText(candidate).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  function renderImage(payload, data) {
    const qr = qrcode(0, "M");
    qr.addData(payload, "Byte");
    qr.make();

    const modules = qr.getModuleCount();
    const quietZone = 4;
    const moduleSize = 10;
    const qrSize = (modules + quietZone * 2) * moduleSize;
    const padding = 24;
    const fontSize = 22;
    const lineHeight = 30;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = `${fontSize}px sans-serif`;

    const amountText = `${formatAmount(IPS.parseAmount(data.amount))} RSD`;
    const caption = [
      ...wrapText(ctx, data.name.trim(), qrSize - padding * 2),
      IPS.formatAccount(IPS.normalizeAccount(data.account)),
      amountText,
    ];
    if (data.purpose.trim()) caption.push(...wrapText(ctx, data.purpose.trim(), qrSize - padding * 2));

    canvas.width = qrSize;
    canvas.height = qrSize + caption.length * lineHeight + padding;

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) {
        if (qr.isDark(row, col)) {
          ctx.fillRect((col + quietZone) * moduleSize, (row + quietZone) * moduleSize, moduleSize, moduleSize);
        }
      }
    }

    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    caption.forEach((line, i) => {
      ctx.font = line === amountText ? `bold ${fontSize}px sans-serif` : `${fontSize}px sans-serif`;
      ctx.fillText(line, canvas.width / 2, qrSize + i * lineHeight);
    });

    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  function fileNameFor(data) {
    const slug = data.name
      .trim()
      .split("\n")[0]
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/gi, "dj")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 30);
    return `ips-${slug || "qr"}-${IPS.parseAmount(data.amount).replace(",", "_")}.png`;
  }

  async function generate(event) {
    event.preventDefault();
    const data = readForm();
    let payload;
    try {
      payload = IPS.buildPayload(data);
    } catch (e) {
      showError(e.message);
      result.hidden = true;
      return;
    }
    showError("");
    localStorage.setItem(PAYER_KEY, data.payer || "");

    const blob = await renderImage(payload, data);
    const fileName = fileNameFor(data);
    currentFile = new File([blob], fileName, { type: "image/png" });
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(blob);

    image.src = currentUrl;
    downloadLink.href = currentUrl;
    downloadLink.download = fileName;
    payloadView.textContent = payload;
    shareButton.hidden = !(navigator.canShare && navigator.canShare({ files: [currentFile] }));
    result.hidden = false;
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function share() {
    if (!currentFile) return;
    try {
      await navigator.share({ files: [currentFile], title: `IPS QR – ${currentFile.name}` });
    } catch (e) {
      if (e.name !== "AbortError") showError(`Sharing failed: ${e.message}`);
    }
  }

  const SCAN_FIELDS = ["account", "name", "amount", "code", "model", "reference", "purpose"];
  const REQUIRED_FIELDS = ["account", "name", "amount"];
  const FIELD_LABELS = {
    account: "account",
    name: "payee",
    amount: "amount",
    code: "payment code",
    model: "model",
    reference: "reference",
    purpose: "purpose",
  };
  const OCR_STATUS_TEXT = {
    "loading tesseract core": "Loading text recognition…",
    "loading language traineddata": "Loading Serbian language data…",
    "initializing api": "Starting text recognition…",
    "recognizing text": "Reading text…",
  };
  const MAX_SCAN_SIDE = 3000;

  const photoInput = document.getElementById("photo");
  const scanPreview = document.getElementById("scan-preview");
  const scanImage = document.getElementById("scan-image");
  const scanStatus = document.getElementById("scan-status");
  const scanProgress = document.getElementById("scan-progress");
  const scanTextDetails = document.getElementById("scan-text-details");
  const scanText = document.getElementById("scan-text");

  let ocrWorkerPromise = null;
  let scanImageUrl = null;

  function setScanStatus(text, progress) {
    scanStatus.textContent = text;
    scanProgress.hidden = progress === null;
    if (progress !== null) scanProgress.value = progress;
  }

  function reportOcrProgress({ status, progress }) {
    const text = OCR_STATUS_TEXT[status];
    if (!text) return;
    const percent = status === "recognizing text" ? ` ${Math.round(progress * 100)}%` : "";
    setScanStatus(text + percent, progress);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`could not load ${src}`));
      document.head.append(script);
    });
  }

  function assetUrl(path) {
    return new URL(path, document.baseURI).href;
  }

  function getOcrWorker() {
    if (!ocrWorkerPromise) {
      ocrWorkerPromise = loadScript("vendor/tesseract/tesseract.min.js")
        .then(() =>
          Tesseract.createWorker("srp_latn", Tesseract.OEM.LSTM_ONLY, {
            workerPath: assetUrl("vendor/tesseract/worker.min.js"),
            corePath: assetUrl("vendor/tesseract/core"),
            langPath: assetUrl("vendor/tesseract/lang"),
            logger: reportOcrProgress,
          })
        )
        .catch((e) => {
          ocrWorkerPromise = null;
          throw e;
        });
    }
    return ocrWorkerPromise;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("the photo could not be opened"));
      img.src = url;
    });
  }

  async function prepareImage(url) {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_SCAN_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function clearFieldMarks() {
    for (const field of SCAN_FIELDS) form.elements[field].classList.remove("recognized", "missing");
  }

  function applyRecognized(parsed) {
    clearFieldMarks();
    for (const field of SCAN_FIELDS) form.elements[field].value = field === "code" ? "289" : "";

    const template = parsed.account && loadTemplates().find((t) => t.account === parsed.account);
    const values = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value));
    if (template) {
      values.name = template.name;
      values.code = template.code || values.code;
      values.purpose = values.purpose || template.purpose;
      values.amount = values.amount || template.amount;
      if (!values.reference && template.reference) {
        values.model = template.model;
        values.reference = template.reference;
      }
    }
    renderTemplateOptions(template ? template.id : "");

    for (const [field, value] of Object.entries(values)) {
      if (!value) continue;
      form.elements[field].value = field === "amount" ? formatAmount(value) : value;
      form.elements[field].classList.add("recognized");
    }
    const missing = REQUIRED_FIELDS.filter((field) => !values[field]);
    for (const field of missing) form.elements[field].classList.add("missing");

    const found = SCAN_FIELDS.filter((field) => values[field]).map((field) => FIELD_LABELS[field]);
    const parts = [];
    parts.push(found.length ? `Recognized: ${found.join(", ")}.` : "Nothing usable was recognized.");
    if (template) parts.push(`Matched saved payee “${template.label}”.`);
    parts.push(
      missing.length
        ? `Please fill in: ${missing.map((field) => FIELD_LABELS[field]).join(", ")}.`
        : "Check the green fields, then tap Generate."
    );
    setScanStatus(parts.join(" "), null);
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function scanBill(file) {
    showError("");
    clearFieldMarks();
    result.hidden = true;
    if (scanImageUrl) URL.revokeObjectURL(scanImageUrl);
    scanImageUrl = URL.createObjectURL(file);
    scanImage.src = scanImageUrl;
    scanPreview.hidden = false;
    scanTextDetails.hidden = true;
    setScanStatus("Preparing photo…", 0);
    try {
      const imageCanvas = await prepareImage(scanImageUrl);
      const worker = await getOcrWorker();
      setScanStatus("Reading text…", 0);
      const { data } = await worker.recognize(imageCanvas);
      scanText.textContent = data.text;
      scanTextDetails.hidden = false;
      applyRecognized(BillParser.parseBill(data.text));
    } catch (e) {
      setScanStatus(`Could not read the photo: ${e.message || e}`, null);
    }
  }

  photoInput.addEventListener("change", () => {
    const file = photoInput.files[0];
    photoInput.value = "";
    if (file) scanBill(file);
  });
  form.addEventListener("input", (event) => event.target.classList.remove("recognized", "missing"));

  form.addEventListener("submit", generate);
  shareButton.addEventListener("click", share);
  document.getElementById("save-template").addEventListener("click", saveCurrentAsTemplate);
  templateSelect.addEventListener("change", () => {
    deleteTemplateButton.disabled = !templateSelect.value;
    applyTemplate(templateSelect.value);
  });
  deleteTemplateButton.addEventListener("click", () => {
    saveTemplates(loadTemplates().filter((t) => t.id !== templateSelect.value));
    renderTemplateOptions("");
  });

  form.elements.payer.value = localStorage.getItem(PAYER_KEY) || "";
  renderTemplateOptions("");
})();
