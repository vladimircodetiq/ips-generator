(function (root) {
  const LIMITS = { name: 70, payer: 70, purpose: 35, reference: 35 };

  function normalizeAccount(input) {
    const raw = String(input || "").replace(/\s+/g, "");
    if (!raw) throw new Error("Account number is required.");
    let digits;
    if (raw.includes("-")) {
      const parts = raw.split("-");
      if (parts.length !== 3 || !parts.every((p) => /^\d+$/.test(p))) {
        throw new Error("Account must look like 160-0000000012345-67.");
      }
      const [bank, middle, control] = parts;
      if (bank.length !== 3 || control.length !== 2 || middle.length > 13) {
        throw new Error("Account must look like 160-0000000012345-67.");
      }
      digits = bank + middle.padStart(13, "0") + control;
    } else {
      if (!/^\d{18}$/.test(raw)) throw new Error("Account must have 18 digits.");
      digits = raw;
    }
    if (BigInt(digits) % 97n !== 1n) throw new Error("Account number control digits are invalid.");
    return digits;
  }

  function formatAccount(digits) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 16)}-${digits.slice(16)}`;
  }

  function parseAmount(input) {
    let s = String(input || "").replace(/[\s']/g, "");
    if (!s) throw new Error("Amount is required.");
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    const decimalPos = Math.max(lastComma, lastDot);
    let intPart = s;
    let fracPart = "";
    if (decimalPos >= 0) {
      const tail = s.slice(decimalPos + 1);
      const bothUsed = lastComma >= 0 && lastDot >= 0;
      if (bothUsed || tail.length <= 2) {
        intPart = s.slice(0, decimalPos);
        fracPart = tail;
      }
    }
    intPart = intPart.replace(/[.,]/g, "");
    if (!/^\d*$/.test(intPart) || !/^\d{0,2}$/.test(fracPart) || (intPart + fracPart) === "") {
      throw new Error("Amount is not a valid number.");
    }
    intPart = intPart.replace(/^0+(?=\d)/, "") || "0";
    fracPart = fracPart.padEnd(2, "0");
    if (/^0+$/.test(intPart + fracPart)) throw new Error("Amount must be greater than zero.");
    if (intPart.length > 12) throw new Error("Amount is too large.");
    return `${intPart},${fracPart}`;
  }

  function cleanText(value, label, max, maxLines) {
    const text = String(value || "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .join("\n");
    if (text.includes("|")) throw new Error(`${label} must not contain the "|" character.`);
    if (text.split("\n").length > maxLines) throw new Error(`${label} can have at most ${maxLines} line(s).`);
    if ([...text].length > max) throw new Error(`${label} can have at most ${max} characters.`);
    return text;
  }

  function referenceDigits(value) {
    return value.toUpperCase().replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  }

  function normalizeReference(model, reference) {
    const m = String(model || "").trim();
    const ref = String(reference || "").replace(/\s+/g, "");
    if (!ref) return "";
    if (m === "97") {
      const plain = ref.replace(/-/g, "");
      if (!/^\d{2}[0-9A-Za-z]+$/.test(plain)) throw new Error("Model 97 reference must be control digits followed by the reference.");
      const check = plain.slice(0, 2);
      const body = plain.slice(2);
      if (BigInt(referenceDigits(body) + check) % 97n !== 1n) {
        throw new Error("Model 97 reference control digits are invalid.");
      }
      return `97${plain.toUpperCase()}`;
    }
    if (m === "" || m === "00") {
      if (!/^[0-9A-Za-z-]+$/.test(ref)) throw new Error("Reference may contain only letters, digits and dashes.");
      const result = `00${ref.toUpperCase()}`;
      if (result.length > LIMITS.reference) throw new Error("Reference is too long.");
      return result;
    }
    if (!/^\d{2}$/.test(m)) throw new Error("Model must be two digits.");
    const result = `${m}${ref.toUpperCase()}`;
    if (!/^[0-9A-Z-]+$/.test(result) || result.length > LIMITS.reference) throw new Error("Reference is invalid.");
    return result;
  }

  function buildPayload(form) {
    const account = normalizeAccount(form.account);
    const name = cleanText(form.name, "Payee", LIMITS.name, 3);
    if (!name) throw new Error("Payee name is required.");
    const amount = parseAmount(form.amount);
    const payer = cleanText(form.payer, "Payer", LIMITS.payer, 3);
    const code = String(form.code || "").trim();
    if (!/^[12]\d{2}$/.test(code)) throw new Error("Payment code must be 3 digits starting with 1 or 2.");
    const purpose = cleanText(form.purpose, "Purpose", LIMITS.purpose, 1);
    const reference = normalizeReference(form.model, form.reference);

    const fields = [
      ["K", "PR"],
      ["V", "01"],
      ["C", "1"],
      ["R", account],
      ["N", name],
      ["I", `RSD${amount}`],
      ["P", payer],
      ["SF", code],
      ["S", purpose],
      ["RO", reference],
    ];
    return fields
      .filter(([, value]) => value !== "")
      .map(([tag, value]) => `${tag}:${value}`)
      .join("|");
  }

  const api = { buildPayload, normalizeAccount, formatAccount, parseAmount, normalizeReference, LIMITS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.IPS = api;
})(typeof window !== "undefined" ? window : globalThis);
