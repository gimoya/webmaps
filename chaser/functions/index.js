const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentUpdated, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret, defineString } = require("firebase-functions/params");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { logger } = require("firebase-functions");

const KOFI_VERIFY_TOKEN = defineSecret("KOFI_VERIFY_TOKEN");
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const KOFI_SHOP_DIRECT_LINK_CODE = defineString("KOFI_SHOP_DIRECT_LINK_CODE", {
  default: ""
});
const CHASER_PUBLIC_BASE = defineString("CHASER_PUBLIC_BASE", {
  default: "https://example.com/webmaps/chaser"
});
const CLAIM_CODE_URL = defineString("CLAIM_CODE_URL", {
  default: "https://europe-west1-chaser-75e2e.cloudfunctions.net/claimCode"
});
const RESEND_FROM = defineString("RESEND_FROM", {
  default: ""
});

// Init once at cold start — lazy getApps() was failing for Firestore triggers.
if (!getApps().length) {
  initializeApp();
}

function firestore() {
  return getFirestore();
}

function messaging() {
  return getMessaging();
}

async function loadPushTokenDocs(eventId) {
  const col = firestore().collection("events").doc(eventId).collection("pushTokens");
  const snap = await col.get();
  return snap.docs.map((doc) => ({ id: doc.id, ref: doc.ref, ...(doc.data() || {}) }));
}

async function sendPushToEvent(eventId, { title, body, kind }) {
  const docs = await loadPushTokenDocs(eventId);
  const tokens = docs.map((d) => d.token).filter((t) => typeof t === "string" && t);
  if (!tokens.length) {
    logger.info("push: no tokens", { eventId, kind });
    return;
  }
  const data = {
    eventId: String(eventId),
    kind: String(kind || ""),
    title: String(title || "Chaser"),
    body: String(body || "")
  };
  const chunkSize = 500;
  for (let i = 0; i < tokens.length; i += chunkSize) {
    const chunk = tokens.slice(i, i + chunkSize);
    // Data-only: SW shows the notification once. Including `notification` here
    // makes the browser display it AND onBackgroundMessage showNotification → doubles.
    const res = await messaging().sendEachForMulticast({
      tokens: chunk,
      data,
      webpush: {
        fcmOptions: {
          link: `${CHASER_PUBLIC_BASE.value().replace(/\/$/, "")}/?event=${encodeURIComponent(eventId)}&mode=viewing`
        }
      }
    });
    const prune = [];
    res.responses.forEach((r, idx) => {
      if (r.success) return;
      const code = r.error && r.error.code;
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        const token = chunk[idx];
        const doc = docs.find((d) => d.token === token);
        if (doc) prune.push(doc.ref);
      }
    });
    await Promise.all(prune.map((ref) => ref.delete().catch(() => {})));
    logger.info("push sent", {
      eventId,
      kind,
      success: res.successCount,
      failure: res.failureCount,
      pruned: prune.length
    });
  }
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

async function chaserOpenUrlForCode(code) {
  const base = CHASER_PUBLIC_BASE.value().replace(/\/$/, "");
  const adminHash = `#admin=${encodeURIComponent(code)}`;
  try {
    const snap = await firestore()
      .collection("events")
      .where("adminCode", "==", code)
      .limit(1)
      .get();
    if (!snap.empty) {
      const eventId = snap.docs[0].id;
      return {
        href: `${base}/?event=${encodeURIComponent(eventId)}&mode=viewing${adminHash}`,
        label: `Open event ${eventId} (admin)`,
        bound: true
      };
    }
  } catch (err) {
    logger.warn("Event lookup by adminCode failed", err);
  }
  return {
    href: `${base}/${adminHash}`,
    label: `Open Chaser with ${code}`,
    bound: false
  };
}

async function buildCodeOpens(codes) {
  const opens = [];
  for (const c of codes || []) {
    if (typeof c !== "string" || !c) continue;
    const open = await chaserOpenUrlForCode(c);
    opens.push({ code: c, href: open.href, label: open.label, bound: open.bound });
  }
  return opens;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

function codesFromData(data) {
  if (!data) return [];
  if (Array.isArray(data.codes) && data.codes.length) {
    return data.codes.filter((c) => typeof c === "string" && c);
  }
  if (typeof data.code === "string" && data.code) return [data.code];
  return [];
}

function claimLinkForTx(tx) {
  const base = CLAIM_CODE_URL.value().replace(/\/$/, "").split("?")[0];
  return `${base}?tx=${encodeURIComponent(tx)}`;
}

function afterPurchaseUrl() {
  return `${CHASER_PUBLIC_BASE.value().replace(/\/$/, "")}/after-purchase.html`;
}

async function sendClaimEmail({ to, txId, codes }) {
  const apiKey = RESEND_API_KEY.value();
  const from = RESEND_FROM.value().trim();
  if (!apiKey || !from) {
    logger.error("Resend not configured (RESEND_API_KEY / RESEND_FROM)");
    return false;
  }
  if (!to || typeof to !== "string") {
    logger.warn("No buyer email on fulfillment; skip claim mail", { txId });
    return false;
  }
  const claimUrl = claimLinkForTx(txId);
  const opens = await buildCodeOpens(codes);
  const codeLines = opens.map((o) => `  ${o.code}\n  ${o.href}`).join("\n");
  const codeHtml = opens
    .map((o) => `<p style="font-size:1.25rem;letter-spacing:0.12em;"><strong>${escapeHtml(o.code)}</strong></p>
      <p><a href="${escapeHtml(o.href)}">${escapeHtml(o.label)}</a></p>`)
    .join("");
  const subject = "Your Chaser admin code";
  const text = `Thanks for your purchase.

Your Chaser admin token(s):
${codeLines}

Open your claim page (bookmark this):
${claimUrl}

Use the token to create/admin your event. Do not share it publicly.
`;
  const html = `<p>Thanks for your purchase.</p>
<p>Your Chaser admin token(s):</p>
${codeHtml}
<p><a href="${escapeHtml(claimUrl)}">Open claim page</a> (bookmark that link).</p>
<p>Use the token to create/admin your event. Do not share it publicly.</p>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from, to: [to], subject, html, text })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error("Resend failed", { status: res.status, body, txId });
    return false;
  }
  logger.info("Claim email sent", { txId, to });
  return true;
}

function keepTokenNotice() {
  const guide = `${CHASER_PUBLIC_BASE.value().replace(/\/$/, "")}/home.html?tab=admins#admin-browser-urls`;
  return `<p class="warn"><strong>Admins can control the app also through a normal browser — for this, keep this 5-character token.</strong> Bookmakr and use it with the URL hash <code>#admin=TOKEN</code>. Do not share the token or that URL publicly. For DEtail on working wuth URL hashes, see: <a href="${escapeHtml(guide)}">Browser / URL details</a> (Event Creation).</p>`;
}

function formatPurchaseAt(ms) {
  if (!ms || !Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(ms));
}

function claimHtml({ codes, code, codeOpens, tx, error, purchasedAt, hint }) {
  const opens = Array.isArray(codeOpens) && codeOpens.length
    ? codeOpens
    : (Array.isArray(codes) && codes.length
      ? codes.map((c) => ({ code: c, href: chaserAdminUrl(c), label: `Open Chaser with ${c}` }))
      : (typeof code === "string" && code
        ? [{ code, href: chaserAdminUrl(code), label: `Open Chaser with ${code}` }]
        : []));
  const title = error ? "Claim" : (opens.length ? "Your Chaser admin code" : "Claim");

  let body = "";
  if (hint) {
    body = `
      <p class="muted">${escapeHtml(hint)}</p>
      ${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
      <p class="muted"><a href="${escapeHtml(afterPurchaseUrl())}">After-purchase help</a></p>`;
  } else if (error) {
    body = `<p class="err">${escapeHtml(error)}</p>
      <p class="muted"><a href="${escapeHtml(afterPurchaseUrl())}">After-purchase help</a></p>`;
  } else {
    body = `${keepTokenNotice()}
       ${purchasedAt ? `<p class="muted">Purchased ${escapeHtml(purchasedAt)}</p>` : ""}
       ${opens.map((o) => `<p class="code">${escapeHtml(o.code)}</p>
       <p><a href="${escapeHtml(o.href)}">${escapeHtml(o.label)}</a></p>`).join("")}`;
  }

  const base = CHASER_PUBLIC_BASE.value().replace(/\/$/, "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Trade+Winds&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${escapeHtml(base)}/home.css">
  <style>
    main { max-width: 32rem; }
    h1 { margin: 0 0 1rem; font-family: var(--title); font-size: 2.5rem; letter-spacing: 0.02em; }
    .code {
      font-size: 1.75rem; letter-spacing: 0.12em; color: var(--accent);
      background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border); border-radius: 6px;
      padding: 0.45rem 0.7rem; margin: 0.35rem 0 0; word-break: break-all;
    }
    a { color: var(--accent); }
    .muted { color: var(--muted); font-size: 0.85rem; }
    .err { color: #f87171; }
    .warn {
      margin: 0 0 1rem; padding: 0.75rem 0.85rem;
      border: 1px solid var(--accent); border-radius: 5px;
      background: rgba(243, 239, 154, 0.08); font-size: 0.88rem; line-height: 1.45;
    }
    .warn strong { color: var(--accent); }
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
    secrets: [KOFI_VERIFY_TOKEN, RESEND_API_KEY],
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
    let mailTo = null;
    let mailCodes = [];
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
        const emailRaw = typeof payload.email === "string" ? payload.email : null;
        const emailNorm = emailRaw ? normalizeEmail(emailRaw) : null;
        txn.set(fulfillments().doc(txId), {
          code: taken[0],
          codes: taken,
          quantity: qty,
          shop_direct_link_code: linkCode,
          amount: String(payload.amount || ""),
          currency: String(payload.currency || ""),
          email: emailRaw,
          emailNormalized: emailNorm,
          message_id: payload.message_id || null,
          from_name: payload.from_name || null,
          createdAt: FieldValue.serverTimestamp(),
          claimedAt: null,
          redeemedAt: null,
          eventId: null
        });
        reserved = true;
        mailTo = emailRaw;
        mailCodes = taken;
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

    if (reserved) {
      try {
        await sendClaimEmail({ to: mailTo, txId, codes: mailCodes });
      } catch (err) {
        logger.error("Claim email threw", err);
      }
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

    const tx = String((req.query && req.query.tx) || "").trim();

    if (!tx) {
      res.status(200).send(claimHtml({
        hint: "Open the claim link from the Chaser email we sent after your Ko-fi purchase (check spam). Email-only lookup is disabled."
      }));
      return;
    }

    const snap = await fulfillments().doc(tx).get();
    if (!snap.exists) {
      res.status(404).send(claimHtml({
        tx,
        error: "No code for that transaction. Wait a moment after purchase, then use the link from your Chaser email."
      }));
      return;
    }
    const data = snap.data();
    const codes = codesFromData(data);
    if (!codes.length) {
      res.status(500).send(claimHtml({ tx, error: "Fulfillment has no code." }));
      return;
    }
    if (!data.claimedAt) {
      await fulfillments().doc(tx).update({
        claimedAt: FieldValue.serverTimestamp()
      });
    }
    const createdMs = data.createdAt && typeof data.createdAt.toMillis === "function"
      ? data.createdAt.toMillis()
      : 0;
    const codeOpens = await buildCodeOpens(codes);
    res.status(200).send(claimHtml({
      codeOpens,
      tx,
      purchasedAt: formatPurchaseAt(createdMs)
    }));
  }
);

exports.onEventCreatedLinkFulfillment = onDocumentCreated("events/{eventId}", async (event) => {
  const data = event.data.data() || {};
  const eventId = event.params.eventId;
  const adminCode = typeof data.adminCode === "string" ? data.adminCode.trim() : "";
  if (!adminCode) return;
  try {
    const snap = await fulfillments()
      .where("codes", "array-contains", adminCode)
      .limit(5)
      .get();
    let docs = snap.docs;
    if (!docs.length) {
      const byCode = await fulfillments().where("code", "==", adminCode).limit(5).get();
      docs = byCode.docs;
    }
    if (!docs.length) {
      logger.info("No fulfillment for new event adminCode", { eventId, adminCode });
      return;
    }
    let linked = 0;
    for (const doc of docs) {
      const row = doc.data() || {};
      if (row.eventId) continue;
      await doc.ref.update({
        eventId,
        redeemedAt: FieldValue.serverTimestamp()
      });
      linked += 1;
    }
    if (linked) {
      logger.info("Linked fulfillment(s) to event", { eventId, adminCode, count: linked });
    }
  } catch (err) {
    logger.error("onEventCreatedLinkFulfillment failed", err);
  }
});

exports.onEventRideLockChanged = onDocumentUpdated("events/{eventId}", async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  const prev = before.rideLocked === true;
  const next = after.rideLocked === true;
  if (prev === next) return;
  const eventId = event.params.eventId;
  const name = typeof after.name === "string" && after.name ? after.name : eventId;
  if (next) {
    await sendPushToEvent(eventId, {
      title: "Ride locked",
      body: `${name}: no new riders can start. Unfinished rides may still resume.`,
      kind: "lock"
    });
  } else {
    await sendPushToEvent(eventId, {
      title: "Ride unlocked",
      body: `${name}: new riders can start tracking.`,
      kind: "unlock"
    });
  }
});

function formatChatPushTime(createdAt) {
  let date;
  if (createdAt && typeof createdAt.toDate === "function") date = createdAt.toDate();
  else if (createdAt instanceof Date) date = createdAt;
  else date = new Date();
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Berlin"
  }).format(date);
}

exports.onEventChatCreated = onDocumentCreated("events/{eventId}/chat/{messageId}", async (event) => {
  const data = event.data.data() || {};
  const eventId = event.params.eventId;
  const from = typeof data.name === "string" && data.name ? data.name : "Rider";
  const text = typeof data.text === "string" ? data.text.trim() : "";
  const hasPhoto = typeof data.photoUrl === "string" && data.photoUrl;
  let message = text;
  if (!message && hasPhoto) message = "sent a photo";
  if (!message) message = "New message";
  const time = formatChatPushTime(data.createdAt);
  let body = `${from} ${time}: ${message}`;
  if (body.length > 120) body = `${body.slice(0, 117)}…`;
  await sendPushToEvent(eventId, {
    title: "Chat",
    body,
    kind: "chat"
  });
});
