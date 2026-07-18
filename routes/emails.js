import express from 'express';
import Email from '../models/Email.js';
import ScheduledEmail from '../models/ScheduledEmail.js';
import ConnectedAccount from '../models/ConnectedAccount.js';
import Template from '../models/Template.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { Op } from 'sequelize';
import { google } from 'googleapis';

const router = express.Router();

// Helper to send real emails via Google Gmail API (with attachments support)
async function sendGmailAPI(account, to, subject, body, attachments = []) {
  const oauth2Client = new google.auth.OAuth2(
    account.clientId,
    account.clientSecret,
    'https://email-automation-backend-dl1c.onrender.com/api/accounts/oauth/callback'
  );

  oauth2Client.setCredentials({
    refresh_token: account.refreshToken
  });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Convert plain text body to HTML (preserve line breaks)
  const htmlBody = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  const boundary = `----=_Part_${Date.now()}`;
  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;

  let mimeLines = [
    `From: ${account.email}`,
    `To: ${to}`,
    `Subject: ${utf8Subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    htmlBody
  ];

  // Attach each file using its base64 data
  if (attachments && attachments.length > 0) {
    for (const file of attachments) {
      if (!file.data) continue; // Skip metadata-only attachments (no binary data)
      mimeLines = mimeLines.concat([
        '',
        `--${boundary}`,
        `Content-Type: ${file.mimeType || 'application/octet-stream'}; name="${file.name}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${file.name}"`,
        '',
        // Chunk base64 data into 76-char lines per MIME standard
        file.data.match(/.{1,76}/g).join('\r\n')
      ]);
    }
  }

  // Close boundary
  mimeLines.push(`--${boundary}--`);

  const rawMessage = mimeLines.join('\r\n');

  // Base64url encode the full MIME message
  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage }
  });

  return res.data;
}


// Get Sent/Failed History
router.get('/sent', authMiddleware, async (req, res) => {
  try {
    const emails = await Email.findAll({
      where: { userId: req.userId },
      order: [['sentAt', 'DESC']]
    });
    res.json(emails);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Scheduled Queue
router.get('/scheduled', authMiddleware, async (req, res) => {
  try {
    const schedules = await ScheduledEmail.findAll({
      where: { userId: req.userId },
      order: [['scheduledAt', 'ASC']]
    });
    res.json(schedules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dispatch Email Now
router.post('/send-now', authMiddleware, async (req, res) => {
  const { to, candidateName, companyName, jobTitle, subject, body, fromAccount, attachments } = req.body;
  try {
    // 1. Check if the sender email has Google API credentials connected
    const account = await ConnectedAccount.findOne({
      where: { email: fromAccount, userId: req.userId }
    });

    let isSuccess = true;
    let errorMsg = null;

    if (account && account.refreshToken && account.clientId && account.clientSecret) {
      // Send REAL email via Google REST APIs
      try {
        await sendGmailAPI(account, to, subject, body, attachments || []);
        isSuccess = true;
      } catch (sendErr) {
        console.error('Google API mail dispatch failed:', sendErr.message);
        isSuccess = false;
        errorMsg = `Google API Delivery Failure: ${sendErr.message}`;
      }
    } else {
      // Simulate random success rate (95% delivered, 5% failed) for demo accounts
      isSuccess = Math.random() > 0.05;
      errorMsg = isSuccess ? null : 'Mail server bounced: SMTP authentication failure';
    }

    const email = await Email.create({
      to,
      candidateName: candidateName || '',
      companyName: companyName || '',
      jobTitle: jobTitle || '',
      subject,
      body,
      fromAccount,
      attachments: attachments || [],
      status: isSuccess ? 'sent' : 'failed',
      errorReason: errorMsg,
      openRate: isSuccess ? (Math.random() > 0.4 ? 1 : 0) : 0, // 60% open rate simulation
      clickRate: isSuccess ? (Math.random() > 0.7 ? 1 : 0) : 0, // 30% click rate simulation
      sentAt: new Date(),
      userId: req.userId
    });

    res.status(201).json(email);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Queue Scheduled Email
router.post('/schedule', authMiddleware, async (req, res) => {
  const { to, candidateName, companyName, jobTitle, subject, body, fromAccount, attachments, scheduledAt, timezone } = req.body;
  try {
    const schedule = await ScheduledEmail.create({
      to,
      candidateName: candidateName || '',
      companyName: companyName || '',
      jobTitle: jobTitle || '',
      subject,
      body,
      fromAccount,
      attachments: attachments || [],
      scheduledAt,
      timezone: timezone || 'UTC',
      status: 'pending',
      userId: req.userId
    });

    res.status(201).json(schedule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pause Schedule
router.post('/scheduled/pause/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const schedule = await ScheduledEmail.findOne({
      where: { id, userId: req.userId }
    });
    if (!schedule) {
      return res.status(404).json({ error: 'Schedule event not found' });
    }

    await schedule.update({ status: 'paused' });
    res.json(schedule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resume Schedule
router.post('/scheduled/resume/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const schedule = await ScheduledEmail.findOne({
      where: { id, userId: req.userId }
    });
    if (!schedule) {
      return res.status(404).json({ error: 'Schedule event not found' });
    }

    await schedule.update({ status: 'pending' });
    res.json(schedule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel Schedule
router.post('/scheduled/cancel/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const schedule = await ScheduledEmail.findOne({
      where: { id, userId: req.userId }
    });
    if (!schedule) {
      return res.status(404).json({ error: 'Schedule event not found' });
    }

    await schedule.update({ status: 'cancelled' });
    res.json(schedule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reschedule Event
router.post('/scheduled/reschedule/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { scheduledAt, timezone } = req.body;
  try {
    const schedule = await ScheduledEmail.findOne({
      where: { id, userId: req.userId }
    });
    if (!schedule) {
      return res.status(404).json({ error: 'Schedule event not found' });
    }

    await schedule.update({
      scheduledAt,
      timezone: timezone || schedule.timezone,
      status: 'pending'
    });

    res.json(schedule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send Scheduled Now
router.post('/scheduled/send-now/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const schedule = await ScheduledEmail.findOne({
      where: { id, userId: req.userId }
    });
    if (!schedule) {
      return res.status(404).json({ error: 'Schedule event not found' });
    }

    // 1. Find Sender account
    const account = await ConnectedAccount.findOne({
      where: { email: schedule.fromAccount, userId: req.userId }
    });

    let isSuccess = true;
    let errorMsg = null;

    if (account && account.refreshToken && account.clientId && account.clientSecret) {
      try {
        await sendGmailAPI(account, schedule.to, schedule.subject, schedule.body, schedule.attachments || []);
        isSuccess = true;
      } catch (sendErr) {
        console.error('Google API scheduled dispatch failed:', sendErr.message);
        isSuccess = false;
        errorMsg = `Google API Delivery Failure: ${sendErr.message}`;
      }
    } else {
      isSuccess = Math.random() > 0.05;
      errorMsg = isSuccess ? null : 'Mail server bounced: SMTP authentication failure';
    }

    // Create sent log
    const email = await Email.create({
      to: schedule.to,
      candidateName: schedule.candidateName,
      companyName: schedule.companyName,
      jobTitle: schedule.jobTitle,
      subject: schedule.subject,
      body: schedule.body,
      fromAccount: schedule.fromAccount,
      attachments: schedule.attachments,
      status: isSuccess ? 'sent' : 'failed',
      errorReason: errorMsg,
      openRate: isSuccess ? (Math.random() > 0.4 ? 1 : 0) : 0,
      clickRate: isSuccess ? (Math.random() > 0.7 ? 1 : 0) : 0,
      sentAt: new Date(),
      userId: req.userId
    });

    // Delete schedule
    await schedule.destroy();

    res.json(email);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Schedule Event
router.delete('/scheduled/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const schedule = await ScheduledEmail.findOne({
      where: { id, userId: req.userId }
    });
    if (!schedule) {
      return res.status(404).json({ error: 'Schedule event not found' });
    }

    await schedule.destroy();
    res.json({ message: 'Schedule event deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Dashboard Aggregated metrics
router.get('/dashboard-stats', authMiddleware, async (req, res) => {
  try {
    const totalSent = await Email.count({ where: { userId: req.userId, status: 'sent' } });
    const totalFailed = await Email.count({ where: { userId: req.userId, status: 'failed' } });
    const totalScheduled = await ScheduledEmail.count({ where: { userId: req.userId, status: 'pending' } });
    
    const successRate = totalSent + totalFailed > 0
      ? Math.round((totalSent / (totalSent + totalFailed)) * 100)
      : 100;

    res.json({
      totalSent,
      totalFailed,
      totalScheduled,
      successRate
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Background Scheduler to process pending scheduled emails every 30 seconds
async function checkAndSendScheduledEmails() {
  try {
    const now = new Date();
    // Find all scheduled emails that are pending and their scheduled time has passed
    const pendingSchedules = await ScheduledEmail.findAll({
      where: {
        status: 'pending',
        scheduledAt: {
          [Op.lte]: now
        }
      }
    });

    if (pendingSchedules.length === 0) return;

    console.log(`[Scheduler] Found ${pendingSchedules.length} pending scheduled emails to process.`);

    for (const schedule of pendingSchedules) {
      // Find the associated connected account
      const account = await ConnectedAccount.findOne({
        where: { email: schedule.fromAccount, userId: schedule.userId }
      });

      let isSuccess = true;
      let errorMsg = null;

      if (account && account.refreshToken && account.clientId && account.clientSecret) {
        try {
          await sendGmailAPI(account, schedule.to, schedule.subject, schedule.body, schedule.attachments || []);
          isSuccess = true;
        } catch (sendErr) {
          console.error(`[Scheduler] Google API scheduled dispatch failed for ${schedule.to}:`, sendErr.message);
          isSuccess = false;
          errorMsg = `Google API Delivery Failure: ${sendErr.message}`;
        }
      } else {
        // Mock email dispatch for demo accounts
        isSuccess = Math.random() > 0.05;
        errorMsg = isSuccess ? null : 'Mail server bounced: SMTP authentication failure';
      }

      // Create sent email log in history
      await Email.create({
        to: schedule.to,
        candidateName: schedule.candidateName,
        companyName: schedule.companyName,
        jobTitle: schedule.jobTitle,
        subject: schedule.subject,
        body: schedule.body,
        fromAccount: schedule.fromAccount,
        attachments: schedule.attachments,
        status: isSuccess ? 'sent' : 'failed',
        errorReason: errorMsg,
        openRate: isSuccess ? (Math.random() > 0.4 ? 1 : 0) : 0,
        clickRate: isSuccess ? (Math.random() > 0.7 ? 1 : 0) : 0,
        sentAt: new Date(),
        userId: schedule.userId
      });

      // Delete the scheduled record once processed
      await schedule.destroy();
      console.log(`[Scheduler] Successfully processed and dispatched scheduled email to ${schedule.to}`);
    }
  } catch (err) {
    console.error('[Scheduler] Error processing scheduled emails:', err.message);
  }
}

// Run the scheduler check loop every 30 seconds
setInterval(checkAndSendScheduledEmails, 30000);

export default router;
