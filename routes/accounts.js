import express from 'express';
import ConnectedAccount from '../models/ConnectedAccount.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();
const router = express.Router();

const REDIRECT_URI = 'https://email-automation-backend-dl1c.onrender.com/api/accounts/oauth/callback';

// Parse Gmail message payloads into clean JSON structures
function parseGmailMessage(message) {
  const payload = message.payload;
  if (!payload) return { id: message.id, subject: '', from: '', date: '', body: '', snippet: message.snippet };

  const headers = payload.headers || [];
  const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
  
  let body = '';
  
  const findPart = (parts, mimeType) => {
    for (const part of parts) {
      if (part.mimeType === mimeType && part.body && part.body.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf8');
      }
      if (part.parts) {
        const content = findPart(part.parts, mimeType);
        if (content) return content;
      }
    }
    return '';
  };

  if (payload.parts) {
    body = findPart(payload.parts, 'text/html') || findPart(payload.parts, 'text/plain');
  } else if (payload.body && payload.body.data) {
    body = Buffer.from(payload.body.data, 'base64').toString('utf8');
  }

  return {
    id: message.id,
    from: getHeader('from'),
    to: getHeader('to'),
    subject: getHeader('subject'),
    date: getHeader('date') || new Date(parseInt(message.internalDate)).toLocaleString(),
    snippet: message.snippet || '',
    body: body || message.snippet || 'No content preview available.'
  };
}

// 1. Get all connected accounts for user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const accounts = await ConnectedAccount.findAll({
      where: { userId: req.userId },
      order: [['isPrimary', 'DESC'], ['createdAt', 'ASC']]
    });
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Connect new Gmail Account (creates record with clientId/clientSecret)
router.post('/connect', authMiddleware, async (req, res) => {
  const { email, connectionType, clientId, clientSecret, refreshToken } = req.body;
  try {
    // Check if account already linked to this user
    const existing = await ConnectedAccount.findOne({
      where: { email, userId: req.userId }
    });
    if (existing) {
      return res.status(400).json({ error: 'This email is already connected to your workspace' });
    }

    const count = await ConnectedAccount.count({ where: { userId: req.userId } });

    const newAccount = await ConnectedAccount.create({
      email,
      connectionType: connectionType || 'Gmail OAuth',
      status: connectionType === 'SMTP App Password' ? 'connected' : 'pending_auth', // SMTP is pre-authorized
      isPrimary: count === 0,
      clientId: clientId || null,
      clientSecret: clientSecret || null,
      refreshToken: refreshToken || null, // Stores SMTP Port if connectionType is SMTP App Password
      userId: req.userId
    });

    res.status(201).json(newAccount);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Initiate Google OAuth Authorization Redirect
router.get('/oauth/auth-url', async (req, res) => {
  const { accountId, token } = req.query;
  
  try {
    if (!token || !accountId) {
      return res.status(400).send('Authorization token and Account ID are required.');
    }

    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_key');
    const userId = decoded.userId;

    // Load account details
    const account = await ConnectedAccount.findOne({
      where: { id: accountId, userId }
    });

    if (!account) {
      return res.status(404).send('Account integration not found.');
    }

    if (!account.clientId || !account.clientSecret) {
      return res.status(400).send('Developer Google Client ID and Client Secret must be configured first.');
    }

    // Initialize OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      account.clientId,
      account.clientSecret,
      REDIRECT_URI
    );

    // Generate consent URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile'
      ],
      // Pass token and accountId securely through the state query
      state: `${token}:${accountId}`,
      prompt: 'consent'
    });

    res.redirect(authUrl);
  } catch (err) {
    res.status(500).send(`Failed to generate Google consent URL: ${err.message}`);
  }
});

// 4. Handle Google OAuth Redirect Callback
router.get('/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`https://email-automation-ashy-nu.vercel.app/accounts?error=${encodeURIComponent(error)}`);
  }

  try {
    if (!code || !state) {
      return res.redirect(`https://email-automation-ashy-nu.vercel.app/accounts?error=${encodeURIComponent('OAuth Callback missing params')}`);
    }

    // Extract JWT token and accountId from state
    const parts = state.split(':');
    const token = parts[0];
    const accountId = parts[1];

    // Verify User JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_key');
    const userId = decoded.userId;

    // Fetch ConnectedAccount record
    const account = await ConnectedAccount.findOne({
      where: { id: accountId, userId }
    });

    if (!account) {
      return res.redirect(`https://email-automation-ashy-nu.vercel.app/accounts?error=${encodeURIComponent('Account not found in session')}`);
    }

    // Initialize OAuth2 Client dynamically
    const oauth2Client = new google.auth.OAuth2(
      account.clientId,
      account.clientSecret,
      REDIRECT_URI
    );

    // Exchange authorization code for refresh tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Read Gmail user info to fetch authenticated email
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const gmailAddress = userInfo.data.email;
    const gmailName = userInfo.data.name;
    const gmailPicture = userInfo.data.picture;

    // Update account status and credentials
    await account.update({
      email: gmailAddress,
      displayName: gmailName || null,
      profilePicture: gmailPicture || null,
      refreshToken: tokens.refresh_token || account.refreshToken, // Google only returns refresh_token on initial consent
      status: 'connected',
      lastSync: new Date()
    });

    res.redirect('https://email-automation-ashy-nu.vercel.app/accounts?success=true');
  } catch (err) {
    res.redirect(`https://email-automation-ashy-nu.vercel.app/accounts?error=${encodeURIComponent(err.message)}`);
  }
});

// 5. Sync/Get Gmail Inbox Messages (Dynamic Google API + Mock Fallback)
router.get('/inbox/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const account = await ConnectedAccount.findOne({
      where: { id, userId: req.userId }
    });
    if (!account) {
      return res.status(404).json({ error: 'Connected account not found' });
    }

    // Mock Fallback: If no refresh token exists (demo account), return mock emails
    if (!account.refreshToken) {
      const mockInbox = [
        {
          id: 'mock_1',
          from: 'Hr Team <hr@stripe.com>',
          to: account.email,
          subject: 'Interview Schedule - Frontend Architect Position',
          date: new Date(Date.now() - 3600000).toLocaleString(),
          snippet: 'Hi Vishal, thanks for applying. We loved your portfolio. Let’s connect...',
          body: '<p>Hi Vishal,</p><p>Thank you for applying. We loved your resume and live project portal dashboard. We would like to schedule an interview this Thursday.</p><p>Best regards,<br>Stripe HR Team</p>'
        },
        {
          id: 'mock_2',
          from: 'Vercel Careers <careers@vercel.com>',
          to: account.email,
          subject: 'Update regarding Frontend Engineer application',
          date: new Date(Date.now() - 7200000 * 3).toLocaleString(),
          snippet: 'Hi Vishal, thank you for completing the technical challenge. We are reviewing...',
          body: '<p>Hi Vishal,</p><p>Thank you for completing the technical coding challenge. Our engineering team is currently reviewing your submission and we will get back to you shortly.</p><p>Best,<br>Vercel Engineering Recruiting</p>'
        },
        {
          id: 'mock_3',
          from: 'GitHub Recruiters <recruit@github.com>',
          to: account.email,
          subject: 'Opportunity: Senior Frontend Developer',
          date: new Date(Date.now() - 86400000).toLocaleString(),
          snippet: 'Hi Vishal, we saw your open source React packages. Are you open to new roles?',
          body: '<p>Hi Vishal,</p><p>We stumbled upon your GitHub profile and saw your advanced React and Framer Motion layouts. We have an opening for a Senior Frontend Developer. Let me know if you are open to a quick call.</p><p>Best regards,<br>GitHub Recruitment</p>'
        }
      ];
      return res.json(mockInbox);
    }

    // Initialize OAuth2 client using custom user keys
    const oauth2Client = new google.auth.OAuth2(
      account.clientId,
      account.clientSecret,
      REDIRECT_URI
    );

    oauth2Client.setCredentials({
      refresh_token: account.refreshToken
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // List latest 50 messages in inbox (increased from 10 to show a comprehensive list)
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: 'label:INBOX',
      maxResults: 50
    });

    const messages = listRes.data.messages || [];

    // Fetch individual email bodies in parallel for significantly faster loading speeds
    const emailPromises = messages.map(async (msg) => {
      try {
        const msgRes = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id
        });
        return parseGmailMessage(msgRes.data);
      } catch (e) {
        console.error(`Failed to parse Gmail message ${msg.id}:`, e.message);
        return null;
      }
    });

    const resolvedEmails = await Promise.all(emailPromises);
    const emails = resolvedEmails.filter(e => e !== null);

    res.json(emails);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5b. Sync/Get Gmail Sent Messages (Dynamic Google API + Mock Fallback)
router.get('/sent/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const account = await ConnectedAccount.findOne({
      where: { id, userId: req.userId }
    });
    if (!account) {
      return res.status(404).json({ error: 'Connected account not found' });
    }

    // Mock Fallback: If no refresh token exists (demo account), return mock sent emails
    if (!account.refreshToken) {
      const mockSent = [
        {
          id: 'mock_sent_1',
          from: account.email,
          to: 'hiring@stripe.com',
          subject: 'Application - Senior React Developer',
          date: new Date(Date.now() - 3600000).toLocaleString(),
          snippet: 'Hi Stripe Recruiting, Please find my application attached for the Senior React role...',
          body: '<p>Hi Stripe Recruiting,</p><p>I am highly interested in the Senior React Developer role at Stripe. I have attached my resume and projects dashboard for your reference.</p><p>Best regards,<br>Vishal Patel</p>'
        },
        {
          id: 'mock_sent_2',
          from: account.email,
          to: 'recruiting@airbnb.com',
          subject: 'Outreach - Vishal Patel - Staff Engineer application',
          date: new Date(Date.now() - 86400000).toLocaleString(),
          snippet: 'Hi Airbnb Careers, I am excited to apply for the Staff Frontend Engineer position...',
          body: '<p>Hi Airbnb Careers,</p><p>I am excited to apply for the Staff Frontend Engineer position. Looking forward to your response.</p><p>Best,<br>Vishal Patel</p>'
        }
      ];
      return res.json(mockSent);
    }

    // Initialize OAuth2 client using custom user keys
    const oauth2Client = new google.auth.OAuth2(
      account.clientId,
      account.clientSecret,
      REDIRECT_URI
    );

    oauth2Client.setCredentials({
      refresh_token: account.refreshToken
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // List latest 50 messages in Gmail Sent
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: 'label:SENT',
      maxResults: 50
    });

    const messages = listRes.data.messages || [];

    // Fetch individual email bodies in parallel for fast loading
    const emailPromises = messages.map(async (msg) => {
      try {
        const msgRes = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id
        });
        return parseGmailMessage(msgRes.data);
      } catch (e) {
        console.error(`Failed to parse Gmail sent message ${msg.id}:`, e.message);
        return null;
      }
    });

    const resolvedEmails = await Promise.all(emailPromises);
    const emails = resolvedEmails.filter(e => e !== null);

    res.json(emails);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5b-2. Sync/Get Gmail Bounce & Failure Messages (Dynamic Google API + Mock Fallback)
router.get('/bounces/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const account = await ConnectedAccount.findOne({
      where: { id, userId: req.userId }
    });
    if (!account) {
      return res.status(404).json({ error: 'Connected account not found' });
    }

    // Mock Fallback: If no refresh token exists (demo account), return mock bounce emails
    if (!account.refreshToken) {
      const mockBounces = [
        {
          id: 'mock_bounce_1',
          from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
          to: account.email,
          subject: 'Delivery Status Notification (Failure)',
          date: new Date(Date.now() - 3600000).toLocaleString(),
          snippet: 'Address not found: Your message wasn\'t delivered to hiring@airbnb.com because...',
          body: '<div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px;"><h3>Address not found</h3><p>Your message wasn\'t delivered to <strong>hiring@airbnb.com</strong> because the address couldn\'t be found, or is unable to receive mail.</p></div>'
        },
        {
          id: 'mock_bounce_2',
          from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
          to: account.email,
          subject: 'Delivery Status Notification (Failure)',
          date: new Date(Date.now() - 7200000).toLocaleString(),
          snippet: 'Address not found: Your message wasn\'t delivered to careers@figma.com because...',
          body: '<div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px;"><h3>Address not found</h3><p>Your message wasn\'t delivered to <strong>careers@figma.com</strong> because the address couldn\'t be found, or is unable to receive mail.</p></div>'
        }
      ];
      return res.json(mockBounces);
    }

    // Initialize OAuth2 client using custom user keys
    const oauth2Client = new google.auth.OAuth2(
      account.clientId,
      account.clientSecret,
      REDIRECT_URI
    );

    oauth2Client.setCredentials({
      refresh_token: account.refreshToken
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // List latest messages matching bounce queries
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: 'from:mailer-daemon OR subject:"Delivery Status Notification" OR "undelivered" OR "bounced"',
      maxResults: 30
    });

    const messages = listRes.data.messages || [];

    // Fetch individual email bodies in parallel
    const emailPromises = messages.map(async (msg) => {
      try {
        const msgRes = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id
        });
        return parseGmailMessage(msgRes.data);
      } catch (e) {
        console.error(`Failed to parse Gmail bounce message ${msg.id}:`, e.message);
        return null;
      }
    });

    const resolvedEmails = await Promise.all(emailPromises);
    const emails = resolvedEmails.filter(e => e !== null);

    res.json(emails);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5c. Poll for NEW inbox emails since last check (for real-time notifications)
// Client sends: { lastHistoryId } — server returns new messages + updated historyId
router.post('/check-new-emails/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { lastHistoryId } = req.body;

  try {
    const account = await ConnectedAccount.findOne({
      where: { id, userId: req.userId }
    });
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (!account.refreshToken) return res.json({ newEmails: [], historyId: null });

    const oauth2Client = new google.auth.OAuth2(
      account.clientId,
      account.clientSecret,
      REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: account.refreshToken });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get current profile historyId
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const currentHistoryId = profile.data.historyId;

    // First call — no previous historyId, just return current historyId as baseline
    if (!lastHistoryId) {
      return res.json({ newEmails: [], historyId: currentHistoryId });
    }

    // Use Gmail history API to fetch changes since last historyId
    let newMessages = [];
    try {
      const historyRes = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: lastHistoryId,
        historyTypes: ['messageAdded'],
        labelId: 'INBOX'
      });

      const historyItems = historyRes.data.history || [];
      const messageIds = new Set();

      historyItems.forEach(item => {
        (item.messagesAdded || []).forEach(ma => {
          if (ma.message && ma.message.labelIds && ma.message.labelIds.includes('INBOX')) {
            messageIds.add(ma.message.id);
          }
        });
      });

      // Fetch full details for new messages
      const fetchPromises = Array.from(messageIds).map(async (msgId) => {
        try {
          const msgRes = await gmail.users.messages.get({ userId: 'me', id: msgId });
          return parseGmailMessage(msgRes.data);
        } catch (e) {
          return null;
        }
      });

      newMessages = (await Promise.all(fetchPromises)).filter(m => m !== null);
    } catch (historyErr) {
      // historyId too old — return empty, client will reset
      return res.json({ newEmails: [], historyId: currentHistoryId, reset: true });
    }

    res.json({ newEmails: newMessages, historyId: currentHistoryId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set Primary Account
router.post('/primary/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const account = await ConnectedAccount.findOne({
      where: { id, userId: req.userId }
    });
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    await ConnectedAccount.update(
      { isPrimary: false },
      { where: { userId: req.userId } }
    );

    await account.update({ isPrimary: true });
    res.json({ message: 'Primary account updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Refresh / Verify Status (includes name & profile picture sync)
router.post('/refresh/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const account = await ConnectedAccount.findOne({
      where: { id, userId: req.userId }
    });
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    let displayName = account.displayName;
    let profilePicture = account.profilePicture;

    if (account.refreshToken && account.clientId && account.clientSecret) {
      try {
        const oauth2Client = new google.auth.OAuth2(
          account.clientId,
          account.clientSecret,
          REDIRECT_URI
        );
        oauth2Client.setCredentials({ refresh_token: account.refreshToken });
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        
        displayName = userInfo.data.name || displayName;
        profilePicture = userInfo.data.picture || profilePicture;
      } catch (oauthErr) {
        console.warn('OAuth refresh profile sync failed:', oauthErr.message);
      }
    }

    // Refresh synchronization timestamps and profile details
    await account.update({
      status: account.refreshToken ? 'connected' : 'pending_auth',
      displayName,
      profilePicture,
      lastSync: new Date()
    });

    res.json(account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync mailbox timestamps
router.post('/sync/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const account = await ConnectedAccount.findOne({
      where: { id, userId: req.userId }
    });
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    await account.update({
      lastSync: new Date()
    });

    res.json(account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disconnect/Delete Account
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const account = await ConnectedAccount.findOne({
      where: { id, userId: req.userId }
    });
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const wasPrimary = account.isPrimary;
    await account.destroy();

    if (wasPrimary) {
      const nextAcc = await ConnectedAccount.findOne({
        where: { userId: req.userId }
      });
      if (nextAcc) {
        await nextAcc.update({ isPrimary: true });
      }
    }

    res.json({ message: 'Account disconnected successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
