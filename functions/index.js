const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const nodemailer = require("nodemailer");

initializeApp();
const db = getFirestore();

// ── Email transport (Outlook / Office 365) ───────────────────────────────────
const getTransport = () =>
  nodemailer.createTransport({
    host: "smtp.office365.com",
    port: 587,
    secure: false, // STARTTLS
    auth: {
      user: process.env.OUTLOOK_USER,
      pass: process.env.OUTLOOK_PASSWORD,
    },
    tls: { ciphers: "SSLv3" },
  });

// ── Email body builders ───────────────────────────────────────────────────────
const buildEmailBody = (d) => {
  const fmt = (v) => (v ? String(v) : "—");
  const fmtAmount = (v) => {
    const n = Number(String(v).replace(/,/g, ""));
    if (isNaN(n)) return fmt(v);
    return n.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  };
  if (d.type === "recommendation") {
    return `
שלום ${fmt(d.managerName)},

תחום "${fmt(d.fieldName)}" בפרויקט "${fmt(d.projectName)}" מוכן לבחירת יועץ מומלץ.

אנא כנסו למערכת CostPilot ובחרו יועץ מומלץ לתחום זה.

בברכה,
מערכת CostPilot
    `.trim();
  }
  const typeLabel = d.type === "pm_approval" ? "מנהל פרויקט" : "מנהל יחידה";
  return `
שלום ${fmt(d.managerName)},

חשבונית ממתינה לאישורך כ${typeLabel} בפרויקט "${fmt(d.projectName)}".

יועץ: ${fmt(d.consultantName)}
מספר חשבון: ${fmt(d.invoiceNum)}
סכום: ${fmtAmount(d.amount)} ₪
שלב: ${fmt(d.milestoneStage)}

אנא כנסו למערכת CostPilot ואשרו את החשבונית.

בברכה,
מערכת CostPilot
  `.trim();
};

const buildReminderBody = (d) => buildEmailBody(d).replace(
  "אנא כנסו",
  "תזכורת — טרם אישרתם את הפריט. אנא כנסו"
);

const subjectFor = (d) => {
  if (d.type === "recommendation") return `CostPilot — בחירת יועץ מומלץ נדרשת: ${d.fieldName || ""}`;
  const typeLabel = d.type === "pm_approval" ? "מנהל פרויקט" : "מנהל יחידה";
  return `CostPilot — חשבונית ממתינה לאישור ${typeLabel}: ${d.projectName || ""}`;
};

const sendEmail = async (to, subject, text) => {
  const transporter = getTransport();
  await transporter.sendMail({
    from: `"CostPilot" <${process.env.OUTLOOK_USER}>`,
    to,
    subject,
    text,
  });
};

// ── Function 1: שליחת מייל מיידי כשנוצר notification חדש ────────────────────
exports.onNotificationCreated = onDocumentCreated(
  "notifications/{notifId}",
  async (event) => {
    const data = event.data.data();
    if (!data || !data.managerEmail || data.resolved) return;
    await sendEmail(data.managerEmail, subjectFor(data), buildEmailBody(data));
    await event.data.ref.update({
      lastNotifiedAt: FieldValue.serverTimestamp(),
      notifiedCount: 1,
    });
  }
);

// ── Function 2: שליחת מיילי תזכורת כל 6 שעות (אחרי 3 ימים ללא אישור) ────────
exports.sendReminders = onSchedule("every 6 hours", async () => {
  const threeDaysAgo = Timestamp.fromMillis(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const snap = await db
    .collection("notifications")
    .where("resolved", "==", false)
    .get();

  for (const docSnap of snap.docs) {
    const d = docSnap.data();
    // Skip if already notified recently (within 3 days from last notification)
    if (d.lastNotifiedAt && d.lastNotifiedAt.toMillis() > threeDaysAgo.toMillis()) continue;
    if (!d.managerEmail) continue;
    await sendEmail(d.managerEmail, subjectFor(d), buildReminderBody(d));
    await docSnap.ref.update({
      lastNotifiedAt: FieldValue.serverTimestamp(),
      notifiedCount: FieldValue.increment(1),
    });
  }
});
