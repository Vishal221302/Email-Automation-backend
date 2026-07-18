import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import ConnectedAccount from '../models/ConnectedAccount.js';
import Template from '../models/Template.js';
import authMiddleware from '../middleware/authMiddleware.js';
import dotenv from 'dotenv';

dotenv.config();
const router = express.Router();

// Register User
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  
  try {
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists with this email address' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      name,
      email,
      password: hashedPassword
    });

    // Seed mock account for user to start with
    await ConnectedAccount.create({
      email: `${name.toLowerCase().replace(/\s+/g, '')}@gmail.com`,
      status: 'connected',
      isPrimary: true,
      connectionType: 'Gmail OAuth',
      userId: newUser.id
    });

    // Seed default template for user
    await Template.create({
      name: 'Frontend Engineer Application',
      category: 'Job Application',
      subject: 'Application for Frontend Engineer Role - {{candidate_name}}',
      body: `Hi {{company_name}} Team,\n\nMy name is {{candidate_name}}, and I'm writing to apply for the Frontend Engineer position at {{company_name}}.\n\nBest regards,\n{{candidate_name}}`,
      attachments: [{ name: 'Alex_Harrison_Resume.pdf', size: '245 KB' }],
      isFavorite: true,
      userId: newUser.id
    });

    const token = jwt.sign(
      { userId: newUser.id },
      process.env.JWT_SECRET || 'fallback_secret_key',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        timezone: newUser.timezone,
        language: newUser.language,
        signature: newUser.signature,
        autoAttachResume: newUser.autoAttachResume
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login User
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(400).json({ error: 'Invalid email credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid password credentials' });
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET || 'fallback_secret_key',
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        timezone: user.timezone,
        language: user.language,
        signature: user.signature,
        autoAttachResume: user.autoAttachResume
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Social Login (Google / Facebook Auth redirect emulation)
router.post('/social-login', async (req, res) => {
  const { email, name, provider, avatar } = req.body;
  try {
    let user = await User.findOne({ where: { email } });

    if (!user) {
      user = await User.create({
        name,
        email,
        provider,
        avatar
      });

      // Seed mock account for user to start with
      await ConnectedAccount.create({
        email: `${name.toLowerCase().replace(/\s+/g, '')}@gmail.com`,
        status: 'connected',
        isPrimary: true,
        connectionType: 'Gmail OAuth',
        userId: user.id
      });

      // Seed default template for user
      await Template.create({
        name: 'Frontend Engineer Application',
        category: 'Job Application',
        subject: 'Application for Frontend Engineer Role - {{candidate_name}}',
        body: `Hi {{company_name}} Team,\n\nMy name is {{candidate_name}}, and I'm writing to apply for the Frontend Engineer position at {{company_name}}.\n\nBest regards,\n{{candidate_name}}`,
        attachments: [{ name: 'Alex_Harrison_Resume.pdf', size: '245 KB' }],
        isFavorite: true,
        userId: user.id
      });
    } else {
      // Update details if they are social login credentials
      await user.update({
        name: name || user.name,
        provider: provider || user.provider,
        avatar: avatar || user.avatar
      });
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET || 'fallback_secret_key',
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        timezone: user.timezone,
        language: user.language,
        signature: user.signature,
        autoAttachResume: user.autoAttachResume,
        avatar: user.avatar
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get User Profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findByPk(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found' });
    }
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      timezone: user.timezone,
      language: user.language,
      signature: user.signature,
      autoAttachResume: user.autoAttachResume
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Profile
router.put('/profile', authMiddleware, async (req, res) => {
  const { name, email, timezone, language, signature, autoAttachResume } = req.body;
  try {
    const user = await User.findByPk(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    // Update settings in database
    await user.update({
      name: name !== undefined ? name : user.name,
      email: email !== undefined ? email : user.email,
      timezone: timezone !== undefined ? timezone : user.timezone,
      language: language !== undefined ? language : user.language,
      signature: signature !== undefined ? signature : user.signature,
      autoAttachResume: autoAttachResume !== undefined ? autoAttachResume : user.autoAttachResume
    });

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      timezone: user.timezone,
      language: user.language,
      signature: user.signature,
      autoAttachResume: user.autoAttachResume
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change Password
router.put('/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  try {
    const user = await User.findByPk(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await user.update({ password: hashedNewPassword });

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// REAL GOOGLE & FACEBOOK OAUTH AUTHENTICATION PIPELINES
// ─────────────────────────────────────────────────────────────────────────────

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USER_INFO = 'https://www.googleapis.com/oauth2/v2/userinfo';

const FACEBOOK_AUTH_URL = 'https://www.facebook.com/v12.0/dialog/oauth';
const FACEBOOK_TOKEN_URL = 'https://graph.facebook.com/v12.0/oauth/access_token';
const FACEBOOK_USER_INFO = 'https://graph.facebook.com/me';

const REDIRECT_URI_GOOGLE = 'https://email-automation-backend-dl1c.onrender.com/api/auth/google/callback';
const REDIRECT_URI_FB = 'https://email-automation-backend-dl1c.onrender.com/api/auth/facebook/callback';

// 1. Google OAuth Authentication Redirect URL
router.get('/google', (req, res) => {
  const { GOOGLE_CLIENT_ID } = process.env;
  if (!GOOGLE_CLIENT_ID) {
    return res.status(400).send(`
      <div style="font-family: sans-serif; max-w: 600px; margin: 80px auto; padding: 30px; border: 1px dashed #e53e3e; border-radius: 16px; background: #fff5f5; color: #9b2c2c; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        <h3 style="margin-top: 0; font-size: 20px;">Google OAuth Keys Missing</h3>
        <p>Real Google Login is active, but credentials are missing in your backend <strong>server/.env</strong> file.</p>
        <p>Please edit <strong>server/.env</strong> and add the following keys:</p>
        <pre style="background: #fff; padding: 12px; border: 1px solid #feb2b2; border-radius: 8px; color: #2d3748; font-family: monospace; font-size: 13px;">
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
        </pre>
        <p style="font-size: 13px; color: #718096; margin-bottom: 0;">Configure these from your <a href="https://console.cloud.google.com" target="_blank" style="color: #3182ce; font-weight: bold; text-decoration: none;">Google Cloud Console</a>.</p>
      </div>
    `);
  }

  const url = `${GOOGLE_AUTH_URL}?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI_GOOGLE)}&response_type=code&scope=email%20profile&prompt=select_account`;
  res.redirect(url);
});

// 2. Google OAuth Redirect Callback Handler
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

  if (error) {
    return res.redirect(`https://email-automation-ashy-nu.vercel.app/login?error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return res.redirect('https://email-automation-ashy-nu.vercel.app/login?error=Google auth code missing');
  }

  try {
    // Exchange Auth Code for Access/ID Tokens
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI_GOOGLE,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenResponse.json();
    if (tokenData.error) {
      throw new Error(tokenData.error_description || tokenData.error);
    }

    // Retrieve verified User Profile details
    const infoResponse = await fetch(GOOGLE_USER_INFO, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const info = await infoResponse.json();

    const email = info.email;
    const name = info.name || email.split('@')[0];
    const picture = info.picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`;

    // Find or register the Google User
    let user = await User.findOne({ where: { email } });
    if (!user) {
      user = await User.create({
        name,
        email,
        provider: 'google',
        avatar: picture
      });

      // Seed mock workspace integrations & template
      await ConnectedAccount.create({
        email: `${name.toLowerCase().replace(/\s+/g, '')}@gmail.com`,
        status: 'connected',
        isPrimary: true,
        connectionType: 'Gmail OAuth',
        userId: user.id
      });

      await Template.create({
        name: 'Frontend Application',
        category: 'Job Application',
        subject: 'Application for Frontend Role - {{candidate_name}}',
        body: `Hi {{company_name}} Team,\n\nMy name is {{candidate_name}}, and I'm applying for the Frontend Developer role at {{company_name}}.\n\nBest,\n{{candidate_name}}`,
        attachments: [{ name: 'Resume.pdf', size: '240 KB' }],
        isFavorite: true,
        userId: user.id
      });
    } else {
      await user.update({
        name: name || user.name,
        provider: 'google',
        avatar: picture || user.avatar
      });
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET || 'fallback_secret_key',
      { expiresIn: '7d' }
    );

    const userPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      timezone: user.timezone,
      language: user.language,
      signature: user.signature,
      autoAttachResume: user.autoAttachResume,
      avatar: user.avatar
    };

    res.redirect(`https://email-automation-ashy-nu.vercel.app/login-success?token=${token}&user=${encodeURIComponent(JSON.stringify(userPayload))}`);
  } catch (err) {
    res.redirect(`https://email-automation-ashy-nu.vercel.app/login?error=${encodeURIComponent(err.message)}`);
  }
});

// 3. Facebook OAuth Authentication Redirect URL
router.get('/facebook', (req, res) => {
  const { FACEBOOK_APP_ID } = process.env;
  if (!FACEBOOK_APP_ID) {
    return res.status(400).send(`
      <div style="font-family: sans-serif; max-w: 600px; margin: 80px auto; padding: 30px; border: 1px dashed #e53e3e; border-radius: 16px; background: #fff5f5; color: #9b2c2c; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        <h3 style="margin-top: 0; font-size: 20px;">Facebook OAuth App ID Missing</h3>
        <p>Real Facebook Login is active, but credentials are missing in your backend <strong>server/.env</strong> file.</p>
        <p>Please edit <strong>server/.env</strong> and add the following keys:</p>
        <pre style="background: #fff; padding: 12px; border: 1px solid #feb2b2; border-radius: 8px; color: #2d3748; font-family: monospace; font-size: 13px;">
FACEBOOK_APP_ID=your_fb_app_id_here
FACEBOOK_APP_SECRET=your_fb_app_secret_here
        </pre>
        <p style="font-size: 13px; color: #718096; margin-bottom: 0;">Configure these from your <a href="https://developers.facebook.com" target="_blank" style="color: #3182ce; font-weight: bold; text-decoration: none;">Facebook Developer Portal</a>.</p>
      </div>
    `);
  }

  const url = `${FACEBOOK_AUTH_URL}?client_id=${FACEBOOK_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI_FB)}&scope=email,public_profile`;
  res.redirect(url);
});

// 4. Facebook OAuth Redirect Callback Handler
router.get('/facebook/callback', async (req, res) => {
  const { code, error } = req.query;
  const { FACEBOOK_APP_ID, FACEBOOK_APP_SECRET } = process.env;

  if (error) {
    return res.redirect(`https://email-automation-ashy-nu.vercel.app/login?error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return res.redirect('https://email-automation-ashy-nu.vercel.app/login?error=Facebook auth code missing');
  }

  try {
    // Exchange Facebook Auth code for Access Token
    const tokenResponse = await fetch(`${FACEBOOK_TOKEN_URL}?client_id=${FACEBOOK_APP_ID}&client_secret=${FACEBOOK_APP_SECRET}&redirect_uri=${encodeURIComponent(REDIRECT_URI_FB)}&code=${code}`);
    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      throw new Error(tokenData.error.message || 'Facebook token exchange failed');
    }

    // Retrieve User Profile info using Graph API
    const infoResponse = await fetch(`${FACEBOOK_USER_INFO}?fields=id,name,email,picture.type(large)&access_token=${tokenData.access_token}`);
    const info = await infoResponse.json();

    const email = info.email || `${info.id}@facebook.com`;
    const name = info.name || 'Facebook User';
    const picture = info.picture?.data?.url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`;

    // Find or register Facebook User
    let user = await User.findOne({ where: { email } });
    if (!user) {
      user = await User.create({
        name,
        email,
        provider: 'facebook',
        avatar: picture
      });

      // Seed mock workspace integrations & template
      await ConnectedAccount.create({
        email: `${name.toLowerCase().replace(/\s+/g, '')}@facebook.com`,
        status: 'connected',
        isPrimary: true,
        connectionType: 'Gmail OAuth',
        userId: user.id
      });

      await Template.create({
        name: 'Facebook Application',
        category: 'Job Application',
        subject: 'Application - {{candidate_name}}',
        body: `Hi {{company_name}} Team,\n\nMy name is {{candidate_name}}, and I'm applying for the role at {{company_name}}.\n\nBest,\n{{candidate_name}}`,
        attachments: [{ name: 'Resume.pdf', size: '200 KB' }],
        isFavorite: true,
        userId: user.id
      });
    } else {
      await user.update({
        name: name || user.name,
        provider: 'facebook',
        avatar: picture || user.avatar
      });
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET || 'fallback_secret_key',
      { expiresIn: '7d' }
    );

    const userPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      timezone: user.timezone,
      language: user.language,
      signature: user.signature,
      autoAttachResume: user.autoAttachResume,
      avatar: user.avatar
    };

    res.redirect(`https://email-automation-ashy-nu.vercel.app/login-success?token=${token}&user=${encodeURIComponent(JSON.stringify(userPayload))}`);
  } catch (err) {
    res.redirect(`https://email-automation-ashy-nu.vercel.app/login?error=${encodeURIComponent(err.message)}`);
  }
});

export default router;
