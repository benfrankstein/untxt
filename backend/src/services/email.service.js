const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initialized = false;

    // Determine auth method based on environment variables
    const useOAuth2 = process.env.SMTP_USE_OAUTH2 === 'true' &&
                      process.env.SMTP_OAUTH2_CLIENT_ID &&
                      process.env.SMTP_OAUTH2_CLIENT_SECRET &&
                      process.env.SMTP_OAUTH2_REFRESH_TOKEN;

    this.config = {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false, // true for 465, false for other ports
      auth: useOAuth2 ? {
        type: 'OAuth2',
        user: process.env.SMTP_USER,
        clientId: process.env.SMTP_OAUTH2_CLIENT_ID,
        clientSecret: process.env.SMTP_OAUTH2_CLIENT_SECRET,
        refreshToken: process.env.SMTP_OAUTH2_REFRESH_TOKEN,
        accessUrl: 'https://oauth2.googleapis.com/token'
      } : {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    };

    this.authMethod = useOAuth2 ? 'OAuth2' : 'App Password';
    this.fromAddress = process.env.SMTP_FROM_ADDRESS || process.env.SMTP_USER;
    this.fromName = process.env.SMTP_FROM_NAME || 'untxt Support';
    this.replyTo = process.env.SMTP_REPLY_TO || 'noreply@untxt.ai';
    this.frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    // Validate configuration based on auth method
    if (!this.config.auth.user) {
      logger.warn('Email service not configured. SMTP_USER environment variable is required.');
      return;
    }

    if (this.authMethod === 'OAuth2') {
      if (!this.config.auth.clientId || !this.config.auth.clientSecret || !this.config.auth.refreshToken) {
        logger.warn('OAuth2 email service not configured. Missing SMTP_OAUTH2_CLIENT_ID, SMTP_OAUTH2_CLIENT_SECRET, or SMTP_OAUTH2_REFRESH_TOKEN.');
        return;
      }
    } else {
      if (!this.config.auth.pass) {
        logger.warn('Email service not configured. SMTP_PASS environment variable is required.');
        return;
      }
    }

    try {
      this.transporter = nodemailer.createTransport(this.config);

      // Verify connection
      await this.transporter.verify();
      this.initialized = true;
      logger.info(`✅ Email service initialized successfully using ${this.authMethod}`);
    } catch (error) {
      logger.error(`Failed to initialize email service (${this.authMethod}):`, error);
      throw error;
    }
  }

  async sendPasswordResetEmail(email, token) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.transporter) {
      throw new Error('Email service is not configured');
    }

    const resetLink = `${this.frontendUrl}/reset-password.html?token=${token}`;

    const mailOptions = {
      from: `"${this.fromName}" <${this.fromAddress}>`,
      to: email,
      replyTo: this.replyTo,
      subject: 'Password Reset Request - untxt',
      text: `Hi,

We received a request to reset your password. Click the link below to reset it:

${resetLink}

This link will expire in 15 minutes.

If you didn't request this, please ignore this email. Your password won't change.

---
untxt Support`,
      html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; margin: 20px 0;">
    <h2 style="color: #2c3e50; margin-top: 0;">Password Reset Request</h2>
    <p>Hi,</p>
    <p>We received a request to reset your password. Click the button below to reset it:</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${resetLink}" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: 500;">Reset Password</a>
    </div>
    <p style="color: #666; font-size: 14px;">Or copy and paste this link into your browser:</p>
    <p style="background-color: #fff; padding: 10px; border-radius: 4px; word-break: break-all; font-size: 13px; color: #007bff;">${resetLink}</p>
    <p style="color: #dc3545; font-weight: 500; margin-top: 20px;">This link will expire in 15 minutes.</p>
    <p style="color: #666; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6;">If you didn't request this, please ignore this email. Your password won't change.</p>
  </div>
  <p style="color: #999; font-size: 12px; text-align: center;">untxt Support</p>
</body>
</html>`
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Password reset email sent to ${email}. MessageId: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error(`Failed to send password reset email to ${email}:`, error);
      throw error;
    }
  }

  async sendPasswordChangedConfirmation(email) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.transporter) {
      throw new Error('Email service is not configured');
    }

    const mailOptions = {
      from: `"${this.fromName}" <${this.fromAddress}>`,
      to: email,
      replyTo: this.replyTo,
      subject: 'Password Changed - untxt',
      text: `Hi,

Your password was successfully changed. If you didn't make this change, please contact support immediately at ${this.fromAddress}.

---
untxt Support`,
      html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; margin: 20px 0;">
    <h2 style="color: #2c3e50; margin-top: 0;">Password Changed</h2>
    <p>Hi,</p>
    <p>Your password was successfully changed.</p>
    <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0; color: #856404;"><strong>⚠️ If you didn't make this change</strong>, please contact support immediately at <a href="mailto:${this.fromAddress}" style="color: #856404;">${this.fromAddress}</a>.</p>
    </div>
    <p style="color: #666; font-size: 14px; margin-top: 30px;">For your security, all active sessions have been logged out. Please log in again with your new password.</p>
  </div>
  <p style="color: #999; font-size: 12px; text-align: center;">untxt Support</p>
</body>
</html>`
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Password changed confirmation email sent to ${email}. MessageId: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error(`Failed to send password changed confirmation to ${email}:`, error);
      throw error;
    }
  }

  async sendTestEmail(email) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.transporter) {
      throw new Error('Email service is not configured');
    }

    const mailOptions = {
      from: `"${this.fromName}" <${this.fromAddress}>`,
      to: email,
      replyTo: this.replyTo,
      subject: 'Test Email - untxt',
      text: 'This is a test email from untxt. Email service is working correctly!',
      html: '<p>This is a test email from untxt. <strong>Email service is working correctly!</strong></p>'
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Test email sent to ${email}. MessageId: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error(`Failed to send test email to ${email}:`, error);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new EmailService();
