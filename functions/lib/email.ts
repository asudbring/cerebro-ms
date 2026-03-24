import { EmailClient } from '@azure/communication-email';

export function isEmailConfigured(): boolean {
  return !!(
    process.env.ACS_CONNECTION_STRING &&
    process.env.ACS_EMAIL_SENDER &&
    process.env.DIGEST_EMAIL_RECIPIENT
  );
}

export async function sendDigestEmail(
  subject: string,
  htmlContent: string,
  recipient?: string
): Promise<void> {
  const connectionString = process.env.ACS_CONNECTION_STRING;
  const senderAddress = process.env.ACS_EMAIL_SENDER;
  const recipientEmail = recipient || process.env.DIGEST_EMAIL_RECIPIENT;

  if (!connectionString || !senderAddress) {
    console.warn('Email not configured: ACS_CONNECTION_STRING or ACS_EMAIL_SENDER missing. Skipping email send.');
    return;
  }

  if (!recipientEmail) {
    console.warn('No email recipient provided and DIGEST_EMAIL_RECIPIENT not set. Skipping email send.');
    return;
  }

  try {
    const client = new EmailClient(connectionString);
    const message = {
      senderAddress,
      content: { subject, html: htmlContent },
      recipients: { to: [{ address: recipientEmail }] },
    };

    const poller = await client.beginSend(message);
    await poller.pollUntilDone();
    console.log(`Digest email sent to ${recipientEmail}`);
  } catch (error) {
    console.error('Failed to send digest email:', error);
  }
}
