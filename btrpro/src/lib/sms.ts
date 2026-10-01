// Text messages (Twilio) — only for crew alerts to project managers. Without TWILIO_* settings nothing is
// sent and the alert stays in the app (bell, My day).
import { prisma } from "@/lib/db";

export const smsConfigured = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);

const e164 = (phone: string) => {
  const d = phone.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
};

export async function sendSms(to: string, body: string) {
  const num = e164(to);
  if (!smsConfigured() || !num) return false;
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: num, From: process.env.TWILIO_FROM_NUMBER!, Body: body.slice(0, 600) }),
  });
  if (!res.ok) console.error("text failed", res.status, (await res.text()).slice(0, 200));
  return res.ok;
}

/** Crew alert to project managers: texted to those who opted in (with a phone), always logged on the job. */
export async function alertPMs(projectId: string, text: string) {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  await prisma.projectActivity.create({ data: { projectId, kind: "crew", text } });
  if (!smsConfigured()) return 0;
  const pms = await prisma.user.findMany({ where: { crewTexts: true, phone: { not: null } }, select: { phone: true } });
  let sent = 0;
  for (const u of pms) if (await sendSms(u.phone!, `BTR · ${p?.name ?? "job"}: ${text}`).catch(() => false)) sent++;
  return sent;
}
