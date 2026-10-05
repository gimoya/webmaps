const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { logger } = require("firebase-functions");

const KOFI_VERIFY_TOKEN = defineSecret("KOFI_VERIFY_TOKEN");
const KOFI_SHOP_DIRECT_LINK_CODE = defineString("KOFI_SHOP_DIRECT_LINK_CODE", {
  default: ""
});
const CHASER_PUBLIC_BASE = defineString("CHASER_PUBLIC_BASE", {
  default: "https://example.com/webmaps/chaser"
});

let db;
function firestore() {
  if (!db) {
    initializeApp();
    db = getFirestore();
  }
  return db;
}

function adminConfigRef() {
  return firestore().collection("adminConfig").doc("current");
}

function fulfillments() {
  return firestore().collection("kofiFulfillments");
}

function parseKofiBody(req) {
  let raw = req.body;
  if (raw && typeof raw === "object" && typeof raw.data === "string") {
    return JSON.parse(raw.data);
  }
  if (typeof raw === "string") {
    const params = new URLSearchParams(raw);
    const data = params.get("data");
    if (data) return JSON.parse(data);
  }
  if (Buffer.isBuffer(raw)) {
    const params = new URLSearchParams(raw.toString("utf8"));
    const data = params.get("data");
    if (data) return JSON.parse(data);
  }
  throw new Error("Missing Ko-fi data field");
}

function normalizeShopLinkCode(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const fromPath = s.match(/ko-fi\.com\/s\/([A-Za-z0-9_-]+)/i);
  if (fromPath) return fromPath[1];
  return s.replace(/^\/+/, "").split("/").pop() || s;
}

function matchingShopQuantity(payload, linkCode) {
  const want = normalizeShopLinkCode(linkCode);
  if (!want) return 0;
  const items = Array.isArray(payload.shop_items) ? payload.shop_items : [];
  let qty = 0;
  for (const item of items) {
    if (!item || normalizeShopLinkCode(item.direct_link_code) !== want) continue;
    const n = Number(item.quantity);
    qty += Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
  }
  return qty;
}

function chaserAdminUrl(code) {
  const base = CHASER_PUBLIC_BASE.value().replace(/\/$/, "");
  return `${base}/#admin=${encodeURIComponent(code)}`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function claimHtml({ codes, code, tx, error }) {
  const list = Array.isArray(codes) && codes.length
    ? codes
    : (typeof code === "string" && code ? [code] : []);
  const title = error ? "Claim" : "Your Chaser admin code";
  const body = error
    ? `<p class="err">${escapeHtml(error)}</p>`
    : `${list.map((c) => `<p class="code">${escapeHtml(c)}</p>
       <p><a href="${escapeHtml(chaserAdminUrl(c))}">Open Chaser with ${escapeHtml(c)}</a></p>`).join("")}
       <p class="muted">Transaction <code>${escapeHtml(tx || "")}</code>. Create an event with a code in the hash (<code>#admin=…</code>). Each code leaves the reserved pool when used to create an event.</p>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #222226; --panel: #2d2d32; --text: #e8e8ec; --muted: #b0b0b8;
      --accent: #f3ef9a; --border: #4a4a54;
      --font: "IBM Plex Mono", "Fira Mono", ui-monospace, monospace;
      --title: "Bebas Neue", Arial, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; color: var(--text); font-family: var(--font);
      background:
        radial-gradient(ellipse at top left, rgba(243, 239, 154, 0.06), transparent 40%),
        radial-gradient(ellipse at bottom right, rgba(59, 130, 246, 0.08), transparent 45%),
        var(--bg);
      line-height: 1.5;
    }
    main { max-width: 28rem; margin: 0 auto; padding: 2.5rem 1.25rem; }
    h1 { margin: 0 0 1rem; font-family: var(--title); font-size: 2.5rem; letter-spacing: 0.02em; }
    .code {
      font-size: 1.75rem; letter-spacing: 0.12em; color: var(--accent);
      background: var(--panel); border: 1px solid var(--border); border-radius: 6px;
      padding: 0.85rem 1rem; word-break: break-all;
    }
    a { color: var(--accent); }
    .muted { color: var(--muted); font-size: 0.85rem; }
    .err { color: #f87171; }
    code { color: var(--accent); }
  </style>
</head>
<body>
  <main>
    <h1>Chaser</h1>
    ${body}
  </main>
</body>
</html>`;
}

exports.kofiWebhook = onRequest(
  {
    region: "europe-west1",
    secrets: [KOFI_VERIFY_TOKEN],
    cors: false
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    let payload;
    try {
      payload = parseKofiBody(req);
    } catch (err) {
      logger.error("Ko-fi parse failed", err);
      res.status(400).send("Bad Request");
      return;
    }

    const expected = KOFI_VERIFY_TOKEN.value();
    if (!payload.verification_token || payload.verification_token !== expected) {
      res.status(401).send("Unauthorized");
      return;
    }

    const done = (msg) => {
      logger.info(msg);
      res.status(200).send("OK");
    };

    if (payload.type !== "Shop Order") {
      done(`Ignored type=${payload.type}`);
      return;
    }

    const linkCode = KOFI_SHOP_DIRECT_LINK_CODE.value().trim();
    if (!linkCode) {
      logger.error("KOFI_SHOP_DIRECT_LINK_CODE is not set");
      done("Shop product code not configured");
      return;
    }

    const qty = matchingShopQuantity(payload, linkCode);
    if (qty < 1) {
      done(`Ignored shop order without product ${linkCode}`);
      return;
    }

    const txId = payload.kofi_transaction_id;
    if (!txId || typeof txId !== "string") {
      done("Missing kofi_transaction_id");
      return;
    }

    const existing = await fulfillments().doc(txId).get();
    if (existing.exists) {
      done(`Idempotent hit tx=${txId}`);
      return;
    }

    let reserved = false;
    try {
      await firestore().runTransaction(async (txn) => {
        const again = await txn.get(fulfillments().doc(txId));
        if (again.exists) return;

        const configSnap = await txn.get(adminConfigRef());
        if (!configSnap.exists) {
          throw new Error("adminConfig/current missing");
        }
        const data = configSnap.data() || {};
        const unused = Array.isArray(data.unusedCodes)
          ? data.unusedCodes.filter((c) => typeof c === "string" && c)
          : [];
        const reservedList = Array.isArray(data.reservedCodes)
          ? data.reservedCodes.filter((c) => typeof c === "string" && c)
          : [];
        if (unused.length < qty) {
          throw new Error("POOL_EMPTY");
        }
        const taken = unused.splice(0, qty);
        reservedList.push(...taken);
        txn.update(adminConfigRef(), {
          unusedCodes: unused,
          reservedCodes: reservedList
        });
        txn.set(fulfillments().doc(txId), {
          code: taken[0],
          codes: taken,
          quantity: qty,
          shop_direct_link_code: linkCode,
          amount: String(payload.amount || ""),
          currency: String(payload.currency || ""),
          email: typeof payload.email === "string" ? payload.email : null,
          message_id: payload.message_id || null,
          from_name: payload.from_name || null,
          createdAt: FieldValue.serverTimestamp(),
          claimedAt: null,
          redeemedAt: null,
          eventId: null
        });
        reserved = true;
      });
    } catch (err) {
      if (err && err.message === "POOL_EMPTY") {
        logger.error("Admin code pool empty", { txId });
        done("Pool empty");
        return;
      }
      logger.error("Fulfillment txn failed", err);
      res.status(500).send("Error");
      return;
    }

    done(reserved ? `Reserved code for tx=${txId}` : `Idempotent hit tx=${txId}`);
  }
);

exports.claimCode = onRequest(
  { region: "europe-west1", cors: false },
  async (req, res) => {
    if (req.method !== "GET") {
      res.status(405).send("Method Not Allowed");
      return;
    }
    const tx = String(req.query.tx || "").trim();
    if (!tx) {
      res.status(400).send(claimHtml({ error: "Missing ?tx= (Ko-fi transaction id)." }));
      return;
    }
    const snap = await fulfillments().doc(tx).get();
    if (!snap.exists) {
      res.status(404).send(claimHtml({
        tx,
        error: "No code for that transaction. Wait a moment after purchase, or check the txid."
      }));
      return;
    }
    const data = snap.data();
    const codes = Array.isArray(data.codes) && data.codes.length
      ? data.codes.filter((c) => typeof c === "string" && c)
      : (typeof data.code === "string" && data.code ? [data.code] : []);
    if (!codes.length) {
      res.status(500).send(claimHtml({ tx, error: "Fulfillment has no code." }));
      return;
    }
    if (!data.claimedAt) {
      await fulfillments().doc(tx).update({
        claimedAt: FieldValue.serverTimestamp()
      });
    }
    res.status(200).send(claimHtml({ codes, code: codes[0], tx }));
  }
);
