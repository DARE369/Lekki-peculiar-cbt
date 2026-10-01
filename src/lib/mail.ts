import "server-only";
import nodemailer from "nodemailer";
import { brand } from "@/lib/brand";

// Notification emails the app sends itself (approvals). Sign-in emails (invitations, password resets)
// are sent by Supabase Auth. Uses the same Google Workspace mailbox: set SMTP_HOST, SMTP_PORT,
// SMTP_USER, SMTP_PASS (an app password) and optionally SMTP_FROM on Vercel. Without them, the app
// simply skips these emails.

export function mailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

let transport: nodemailer.Transporter | null = null;
function getTransport() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT ?? 465);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transport;
}

/** Sends one email. Never throws: a failed notification must not undo the approval itself. */
export async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  if (!mailConfigured()) return false;
  try {
    await getTransport().sendMail({
      from: process.env.SMTP_FROM || `"${brand.schoolName}" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
      textEncoding: "quoted-printable",
    });
    return true;
  } catch (e) {
    console.error("Email to", to, "failed:", e);
    return false;
  }
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/**
 * The school's email layout (same look as the invitation): logo, blue heading band, body, button.
 * `body` is trusted HTML built by the caller with esc() for any user-entered text.
 */
export function emailLayout(o: { siteUrl: string; badge: string; title: string; body: string; button?: { label: string; href: string } }) {
  const button = o.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:26px auto 6px"><tr><td style="background:#1d3f9a;border-radius:12px"><a href="${o.button.href}" style="display:inline-block;padding:15px 34px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px">${esc(o.button.label)}</a></td></tr></table>`
    : "";
  return `<div style="margin:0;padding:0;background:#eef1f7"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dfe4ee;font-family:'Plus Jakarta Sans',Segoe UI,Arial,Helvetica,sans-serif;color:#1f2937">
<tr><td align="center" style="background:#ffffff;padding:26px 32px 18px"><img src="${o.siteUrl}/brand/email-logo.png" width="200" alt="${esc(brand.schoolName)}" style="display:block;width:200px;max-width:60%;height:auto;border:0"></td></tr>
<tr><td style="background:#1d3f9a;background-image:linear-gradient(135deg,#1d3f9a 0%,#15306f 100%);padding:24px 32px 28px">
<div style="display:inline-block;background:rgba(241,192,79,0.18);color:#f1c04f;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;padding:5px 10px;border-radius:999px">${esc(o.badge)}</div>
<div style="margin-top:10px;font-size:24px;font-weight:800;color:#ffffff;line-height:1.3">${esc(o.title)}</div></td></tr>
<tr><td style="padding:30px 32px;font-size:15px;line-height:1.7;color:#374151">${o.body}${button}
<p style="margin:28px 0 0;font-size:14px;color:#374151">Warm regards,<br><strong style="color:#1f2937">Management</strong><br><span style="font-size:13px;color:#6b7280">${esc(brand.schoolName)}</span></p></td></tr>
<tr><td style="background:#f6f8fc;padding:18px 32px;border-top:1px solid #e3e8f2;text-align:center;font-size:12px;color:#8a94a6">${esc(brand.schoolName)} · ${brand.coreValues.map(esc).join(" · ")}</td></tr>
</table></td></tr></table></div>`;
}

export { esc as escapeHtml };
