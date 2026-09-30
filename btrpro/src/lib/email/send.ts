// Outbound email via Postmark (POSTMARK_SERVER_TOKEN + EMAIL_FROM). Without it, callers show a link to copy instead.
export const emailConfigured = () => !!(process.env.POSTMARK_SERVER_TOKEN && process.env.EMAIL_FROM);

export async function sendEmail(msg: { to: string; subject: string; text: string; replyTo?: string; attachments?: { name: string; contentType: string; bytes: Uint8Array }[] }) {
  if (!emailConfigured()) throw new Error("Outbound email isn't configured (POSTMARK_SERVER_TOKEN, EMAIL_FROM).");
  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN! },
    body: JSON.stringify({
      From: process.env.EMAIL_FROM,
      To: msg.to,
      Subject: msg.subject,
      TextBody: msg.text,
      ReplyTo: msg.replyTo,
      MessageStream: "outbound",
      Attachments: msg.attachments?.map((a) => ({ Name: a.name, ContentType: a.contentType, Content: Buffer.from(a.bytes).toString("base64") })),
    }),
  });
  if (!res.ok) throw new Error(`Email failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}
