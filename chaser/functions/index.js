const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentUpdated, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret, defineString } = require("firebase-functions/params");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { logger } = require("firebase-functions");

const KOFI_VERIFY_TOKEN = defineSecret("KOFI_VERIFY_TOKEN");
const KOFI_SHOP_DIRECT_LINK_CODE = defineString("KOFI_SHOP_DIRECT_LINK_CODE", {
  default: ""
});
const CHASER_PUBLIC_BASE = defineString("CHASER_PUBLIC_BASE", {
  default: "https://example.com/webmaps/chaser"
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
    const res = await messaging().sendEachForMulticast({
      tokens: chunk,
      notification: { title: data.title, body: data.body },
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

function claimPageUrl(req, tx) {
  const host = req.get("x-forwarded-host") || req.get("host") || "";
  const proto = req.get("x-forwarded-proto") || "https";
  const base = host ? `${proto}://${host}` : "";
  const path = (req.path || "/claimCode").split("?")[0] || "/claimCode";
  return `${base}${path}?tx=${encodeURIComponent(tx)}`;
}

function keepTokenNotice() {
  return `<p class="warn"><strong>Keep this 5-character token.</strong> You need it to <strong>create</strong> your event (<code>#admin=TOKEN</code>) and later for <strong>admin access</strong> on that event (GPX upload, clear traces, delete riders). Bookmark a URL that still includes <code>#admin=TOKEN</code>. Do not share the token publicly.</p>`;
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

function claimHtml({ codes, code, tx, error, showLookup, emailValue, matches, purchasedAt }) {
  const list = Array.isArray(codes) && codes.length
    ? codes
    : (typeof code === "string" && code ? [code] : []);
  const title = error && !showLookup ? "Claim" : "Your Chaser admin code";

  let body = "";
  if (showLookup) {
    body = `
      <p class="muted">Enter the email you used at Ko-fi checkout.</p>
      ${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
      <form method="GET" action="" class="lookup">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" required autocomplete="email"
          value="${escapeHtml(emailValue || "")}" placeholder="you@example.com">
        <button type="submit">Find my code</button>
      </form>`;
    if (Array.isArray(matches) && matches.length) {
      body += keepTokenNotice();
      body += `<ul class="matches">` + matches.map((m) => `
        <li class="match">
          ${m.purchasedAt ? `<p class="match-when">Purchased ${escapeHtml(m.purchasedAt)}</p>` : ""}
          ${m.codes.map((c) => `<p class="code">${escapeHtml(c)}</p>
            <p class="match-open"><a href="${escapeHtml(chaserAdminUrl(c))}">Open Chaser with ${escapeHtml(c)}</a></p>`).join("")}
        </li>`).join("") + `</ul>`;
    }
  } else if (error) {
    body = `<p class="err">${escapeHtml(error)}</p>
      <p class="muted"><a href="?">Look up by email</a></p>`;
  } else {
    body = `${keepTokenNotice()}
       ${purchasedAt ? `<p class="muted">Purchased ${escapeHtml(purchasedAt)}</p>` : ""}
       ${list.map((c) => `<p class="code">${escapeHtml(c)}</p>
       <p><a href="${escapeHtml(chaserAdminUrl(c))}">Open Chaser with ${escapeHtml(c)}</a></p>`).join("")}
       <p class="muted"><a href="?">Look up another purchase by email</a></p>`;
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
    .lookup { display: grid; gap: 0.5rem; margin: 1rem 0; }
    .lookup label { font-size: 0.8rem; color: var(--muted); }
    .lookup input {
      font: inherit; padding: 0.55rem 0.65rem; border-radius: 5px;
      border: 1px solid var(--border); background: var(--panel); color: var(--text);
    }
    .lookup button {
      font: inherit; padding: 0.55rem 0.75rem; border-radius: 5px; border: 0;
      background: var(--accent); color: var(--bg); cursor: pointer; font-weight: 600;
    }
    .matches { list-style: none; margin: 1.5rem 0 0; padding: 0; display: grid; gap: 1.5rem; }
    .match {
      margin: 0; padding: 0.65rem 0.75rem;
      border: 1px solid var(--border); border-radius: 6px; background: var(--panel);
    }
    .match-when { margin: 0 0 0.15rem; color: var(--muted); font-size: 0.8rem; }
    .match-open { margin: 0.2rem 0 0; }
    .match-open a { word-break: break-all; font-size: 0.85rem; }
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
    if (req.method !== "GET" && req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const tx = String((req.query && req.query.tx) || (req.body && req.body.tx) || "").trim();
    const emailRaw = String(
      (req.query && req.query.email) || (req.body && req.body.email) || ""
    ).trim();
    const emailNorm = normalizeEmail(emailRaw);

    if (!tx && !emailNorm) {
      res.status(200).send(claimHtml({ showLookup: true }));
      return;
    }

    if (!tx && emailNorm) {
      const byId = new Map();
      const absorb = (snap) => {
        if (!snap || snap.empty) return;
        snap.docs.forEach((doc) => {
          if (!byId.has(doc.id)) byId.set(doc.id, doc);
        });
      };

      try {
        absorb(await fulfillments()
          .where("emailNormalized", "==", emailNorm)
          .limit(25)
          .get());
        absorb(await fulfillments()
          .where("email", "==", emailRaw)
          .limit(25)
          .get());
        if (emailRaw !== emailNorm) {
          absorb(await fulfillments()
            .where("email", "==", emailNorm)
            .limit(25)
            .get());
        }
      } catch (err) {
        logger.error("Email lookup failed", err);
        res.status(500).send(claimHtml({
          showLookup: true,
          emailValue: emailRaw,
          error: "Lookup failed. Try again in a moment."
        }));
        return;
      }

      if (!byId.size) {
        res.status(404).send(claimHtml({
          showLookup: true,
          emailValue: emailRaw,
          error: "No purchase found for that email. Use the same address as at Ko-fi checkout, or wait a few seconds after paying."
        }));
        return;
      }

      const rows = [...byId.values()].map((doc) => {
        const data = doc.data() || {};
        const created = data.createdAt && typeof data.createdAt.toMillis === "function"
          ? data.createdAt.toMillis()
          : 0;
        return { id: doc.id, data, created };
      });
      rows.sort((a, b) => b.created - a.created);

      const matches = rows.map((row) => ({
        url: claimPageUrl(req, row.id),
        codes: codesFromData(row.data),
        tx: row.id,
        purchasedAt: formatPurchaseAt(row.created)
      })).filter((m) => m.codes.length);

      if (!matches.length) {
        res.status(500).send(claimHtml({
          showLookup: true,
          emailValue: emailRaw,
          error: "Purchase found but it has no code. Contact the seller."
        }));
        return;
      }

      if (matches.length === 1) {
        const only = matches[0];
        const docRef = fulfillments().doc(only.tx);
        const fresh = await docRef.get();
        if (fresh.exists && !fresh.data().claimedAt) {
          await docRef.update({ claimedAt: FieldValue.serverTimestamp() });
        }
        res.status(200).send(claimHtml({
          codes: only.codes,
          code: only.codes[0],
          tx: only.tx,
          purchasedAt: only.purchasedAt
        }));
        return;
      }

      res.status(200).send(claimHtml({
        showLookup: true,
        emailValue: emailRaw,
        matches
      }));
      return;
    }

    const snap = await fulfillments().doc(tx).get();
    if (!snap.exists) {
      res.status(404).send(claimHtml({
        tx,
        error: "No code for that transaction. Wait a moment after purchase, or look up by email."
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
    res.status(200).send(claimHtml({
      codes,
      code: codes[0],
      tx,
      purchasedAt: formatPurchaseAt(createdMs)
    }));
  }
);

exports.onEventRaceLockChanged = onDocumentUpdated("events/{eventId}", async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  const prev = before.raceLocked === true;
  const next = after.raceLocked === true;
  if (prev === next) return;
  const eventId = event.params.eventId;
  const name = typeof after.name === "string" && after.name ? after.name : eventId;
  if (next) {
    await sendPushToEvent(eventId, {
      title: "Race locked",
      body: `${name}: no new riders can start. Unfinished rides may still resume.`,
      kind: "lock"
    });
  } else {
    await sendPushToEvent(eventId, {
      title: "Race unlocked",
      body: `${name}: new riders can start tracking.`,
      kind: "unlock"
    });
  }
});

exports.onEventChatCreated = onDocumentCreated("events/{eventId}/chat/{messageId}", async (event) => {
  const data = event.data.data() || {};
  const eventId = event.params.eventId;
  const from = typeof data.name === "string" && data.name ? data.name : "Rider";
  const text = typeof data.text === "string" ? data.text.trim() : "";
  const hasPhoto = typeof data.photoUrl === "string" && data.photoUrl;
  let body = text;
  if (!body && hasPhoto) body = "sent a photo";
  if (!body) body = "New message";
  if (body.length > 120) body = `${body.slice(0, 117)}…`;
  await sendPushToEvent(eventId, {
    title: `Chat · ${from}`,
    body,
    kind: "chat"
  });
});
