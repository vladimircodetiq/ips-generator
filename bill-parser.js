(function (root) {
  const IPS = root.IPS || (typeof require !== "undefined" ? require("./ips.js") : null);

  const AMOUNT_PATTERN = /(?<![\d.,])\d{1,3}(?:[. ]\d{3})+[,.]\d{2}(?!\d)|(?<![\d.,])\d+[,.]\d{2}(?!\d)/g;
  const LEGAL_FORM = /\b(d\.?\s?o\.?\s?o|a\.?\s?d|d\.?\s?d|jkp|jp|pu|javno preduzece|javno komunalno)\b/;
  const LABEL_WORDS = /(uplatilac|primalac|svrha|sifra|valuta|iznos|racun (primaoca|uplatioca)|model|poziv|potpis|pecat|datum|mesto|nalog za uplatu|hitno)/;

  function simplify(text) {
    return text
      .toLowerCase()
      .replace(/đ/g, "dj")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function prepareLines(text) {
    return text
      .replace(/[–—−]/g, "-")
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((original) => ({ original, simple: simplify(original) }));
  }

  function withoutTexts(lines, texts) {
    return lines
      .map((line) => {
        let original = line.original;
        for (const text of texts) original = original.split(text).join(" ");
        original = original.replace(/\s+/g, " ").trim();
        return { original, simple: simplify(original) };
      })
      .filter((line) => line.original);
  }

  function tryAccount(digits) {
    try {
      return IPS.normalizeAccount(digits);
    } catch {
      return null;
    }
  }

  function findAccounts(lines) {
    const found = [];
    lines.forEach((line, index) => {
      const dashed = /(\d{3}) ?- ?(\d(?:[\d ]{0,15}\d)?) ?- ?(\d{2})(?!\d)/g;
      for (const m of line.original.matchAll(dashed)) {
        const middle = m[2].replace(/ /g, "");
        if (middle.length > 13) continue;
        const account = tryAccount(`${m[1]}-${middle}-${m[3]}`);
        if (account) found.push({ account, index, text: m[0] });
      }
      for (const m of line.original.matchAll(/(?<!\d)\d{18}(?!\d)/g)) {
        const account = tryAccount(m[0]);
        if (account) found.push({ account, index, text: m[0] });
      }
    });
    return found;
  }

  function pickAccount(lines, accounts) {
    if (!accounts.length) return null;
    const nearPayeeLabel = accounts.find(({ index }) =>
      [index, index - 1, index - 2].some((i) => i >= 0 && /racun primaoca|tekuci racun|ziro racun|uplatni racun/.test(lines[i].simple))
    );
    return (nearPayeeLabel || accounts[0]).account;
  }

  function amountScore(lines, index) {
    const scoreOf = (simple) => {
      if (/za uplatu|za placanje|ukupno zaduzenje|ukupan iznos/.test(simple)) return 4;
      if (/iznos/.test(simple)) return 3;
      if (/ukupno|svega/.test(simple)) return 2;
      return 0;
    };
    const own = scoreOf(lines[index].simple);
    const above = index > 0 ? scoreOf(lines[index - 1].simple) - 1 : 0;
    const equalsSign = /=\s*\d/.test(lines[index].original) ? 1 : 0;
    const currency = /rsd|din/.test(lines[index].simple) ? 1 : 0;
    return Math.max(own, above, 0) + equalsSign + currency;
  }

  function findAmount(lines, accountTexts) {
    const candidates = [];
    lines.forEach((line, index) => {
      let text = line.original;
      for (const accountText of accountTexts) text = text.split(accountText).join(" ");
      for (const m of text.matchAll(AMOUNT_PATTERN)) {
        let amount;
        try {
          amount = IPS.parseAmount(m[0].replace(/ /g, ""));
        } catch {
          continue;
        }
        const value = Number(amount.replace(",", "."));
        candidates.push({ amount, value, score: amountScore(lines, index) });
      }
    });
    if (!candidates.length) return null;
    const best = Math.max(...candidates.map((c) => c.score));
    return candidates.filter((c) => c.score === best).sort((a, b) => b.value - a.value)[0].amount;
  }

  function findReference(lines, accountTexts) {
    const cleaned = withoutTexts(lines, accountTexts);

    for (const line of cleaned) {
      for (const m of line.original.matchAll(/(?<!\d)97 ?([\d][\d -]{3,28}\d)(?!\d)/g)) {
        const digits = m[1].replace(/[ -]/g, "");
        try {
          return { model: "97", reference: IPS.normalizeReference("97", digits).slice(2), text: m[0] };
        } catch {
          continue;
        }
      }
    }

    const labelIndex = cleaned.findIndex((line) => /poziv na broj|poziv na br|model/.test(line.simple));
    if (labelIndex < 0) return null;
    for (const line of cleaned.slice(labelIndex, labelIndex + 3)) {
      const afterLabel = line.original.replace(/^.*?(poziv na broj[^:\d]*|model[^:\d]*)[:.]?/i, "");
      if (/^\s*97\s/.test(afterLabel)) continue;
      const withModel = afterLabel.match(/(?:^|\s)(\d{2}) ([0-9A-Z][0-9A-Z-]{2,22})(?:\s|$)/);
      if (withModel && withModel[1] !== "97") return { model: withModel[1], reference: withModel[2], text: withModel[0].trim() };
      const bare = afterLabel.match(/(?:^|\s)(\d[\d-]{4,22}\d)(?:\s|$)/);
      if (bare) return { model: "", reference: bare[1], text: bare[1] };
    }
    return null;
  }

  function findPaymentCode(lines) {
    for (let index = 0; index < lines.length; index++) {
      if (!/sifra/.test(lines[index].simple) || /sifra (korisnika|kupca|potrosaca|objekta)/.test(lines[index].simple)) continue;
      for (const line of lines.slice(index, index + 2)) {
        const m = line.original.match(/(?<![\d.,])([12]\d{2})(?![\d.,])/);
        if (m) return `2${m[1].slice(1)}`;
      }
    }
    return null;
  }

  function isTextLine(line) {
    const letters = (line.original.match(/\p{L}/gu) || []).length;
    return letters >= 3 && letters >= line.original.replace(/\s/g, "").length / 2;
  }

  function textAfterLabel(lines, labelPattern, maxLines) {
    const index = lines.findIndex((line) => labelPattern.test(line.simple));
    if (index < 0) return null;
    const collected = [];
    const sameLine = lines[index].original.replace(/^.*?[:]/, "").trim();
    if (sameLine !== lines[index].original && sameLine.length >= 3) collected.push(sameLine);
    for (const line of lines.slice(index + 1)) {
      if (collected.length >= maxLines) break;
      if (LABEL_WORDS.test(line.simple) || !isTextLine(line)) break;
      collected.push(line.original);
    }
    return collected.length ? collected.join("\n") : null;
  }

  function findPayee(lines) {
    const afterLabel = textAfterLabel(lines, /^primalac|\bprimalac\b/, 2);
    if (afterLabel) return afterLabel.slice(0, IPS.LIMITS.name);
    const company = lines.find((line) => LEGAL_FORM.test(line.simple) && isTextLine(line));
    return company ? company.original.slice(0, IPS.LIMITS.name) : null;
  }

  function findPurpose(lines) {
    const purpose = textAfterLabel(lines, /svrha/, 1);
    return purpose ? purpose.slice(0, IPS.LIMITS.purpose) : null;
  }

  function parseBill(text) {
    const lines = prepareLines(text);
    const accounts = findAccounts(lines);
    const accountTexts = accounts.map((a) => a.text);
    const reference = findReference(lines, accountTexts);
    const account = pickAccount(lines, accounts);
    const textLines = withoutTexts(lines, [...accountTexts, ...(reference ? [reference.text] : [])]);
    return {
      account: account ? IPS.formatAccount(account) : null,
      amount: findAmount(lines, accountTexts),
      model: reference ? reference.model : null,
      reference: reference ? reference.reference : null,
      code: findPaymentCode(lines),
      name: findPayee(textLines),
      purpose: findPurpose(textLines),
    };
  }

  const api = { parseBill };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BillParser = api;
})(typeof window !== "undefined" ? window : globalThis);
