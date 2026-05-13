export interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

export class EmailService {
    private readonly apiKey: string;
    private readonly fromAddress = 'noreply@rankbuilder.app';
    private readonly fromName = 'RankBuilder';

    constructor(env: Env) {
        this.apiKey = env.SENDGRID_API_KEY;
    }

    async sendEmail(options: EmailOptions): Promise<void> {
        const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                personalizations: [{ to: [{ email: options.to }] }],
                from: { email: this.fromAddress, name: this.fromName },
                subject: options.subject,
                content: [
                    { type: 'text/plain', value: options.text ?? options.html.replace(/<[^>]*>/g, '') },
                    { type: 'text/html', value: options.html },
                ],
            }),
        });

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`SendGrid error ${response.status}: ${body}`);
        }
    }

    async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
        await this.sendEmail({
            to,
            subject: 'Reset your RankBuilder password',
            html: `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#0a0a0a;color:#e0e0e0;margin:0;padding:32px;">
  <div style="max-width:520px;margin:0 auto;background:#111;border:1px solid #222;border-radius:12px;padding:32px;">
    <img src="https://rankbuilder.app/favicon-96x96.png" alt="RankBuilder" style="width:40px;height:40px;margin-bottom:16px;" />
    <h2 style="color:#fff;margin:0 0 8px;">Reset your password</h2>
    <p style="color:#aaa;margin:0 0 24px;">You requested a password reset for your RankBuilder account. Click the button below to choose a new password.</p>
    <a href="${resetUrl}" style="display:inline-block;background:#00E676;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin-bottom:24px;">Reset password</a>
    <p style="color:#666;font-size:13px;margin:0;">This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>
  </div>
</body>
</html>`,
        });
    }
}
