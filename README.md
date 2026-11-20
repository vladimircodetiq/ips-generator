# IPS QR generator

Static web app that generates NBS IPS QR codes (payment slip, `K:PR`) for bills that don't have one.
Everything runs in the browser; no data leaves the device. Saved payees and the payer are kept in `localStorage`.

## Use

**Scan:** tap **Scan bill**, take a photo (or pick one). Text is recognized on the device with Tesseract.js
(Serbian Latin), the form is filled in, recognized fields are green and missing required ones are orange.
Check them and tap **Generate QR code**. The first scan downloads ~6 MB of recognition data, cached afterwards.
If the recognized account matches a saved payee, the payee name, code and purpose come from the saved payee.

**Manual:**

1. Fill in payee account, name, amount, payment code (default 289), optional model/reference/purpose.
2. Tap **Generate QR code**.
3. Tap **Send by email / share** and pick Mail (or save to Photos and use the bank app's "load from gallery" option).

## Hosting

The share button needs HTTPS. Any static host works, e.g.:

- **GitHub Pages**: push this folder to a repo, enable Pages on the main branch.
- **Netlify Drop**: drag the folder onto https://app.netlify.com/drop.

On the iPhone, open the URL in Safari → Share → **Add to Home Screen**.

Local test: `python -m http.server 8765` and open http://localhost:8765.
