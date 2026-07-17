import express from 'express';
import Template from '../models/Template.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

// Get all templates for user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const templates = await Template.findAll({
      where: { userId: req.userId },
      order: [['createdAt', 'DESC']]
    });
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create Template
router.post('/', authMiddleware, async (req, res) => {
  const { name, category, subject, body, attachments } = req.body;
  try {
    const newTemplate = await Template.create({
      name,
      category,
      subject,
      body,
      attachments: attachments || [],
      userId: req.userId
    });
    res.status(201).json(newTemplate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit Template
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { name, category, subject, body, attachments } = req.body;
  try {
    const template = await Template.findOne({
      where: { id, userId: req.userId }
    });
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    await template.update({
      name: name !== undefined ? name : template.name,
      category: category !== undefined ? category : template.category,
      subject: subject !== undefined ? subject : template.subject,
      body: body !== undefined ? body : template.body,
      attachments: attachments !== undefined ? attachments : template.attachments
    });

    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Duplicate Template
router.post('/duplicate/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const template = await Template.findOne({
      where: { id, userId: req.userId }
    });
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const copy = await Template.create({
      name: `${template.name} (Copy)`,
      category: template.category,
      subject: template.subject,
      body: template.body,
      attachments: template.attachments,
      isFavorite: false,
      userId: req.userId
    });

    res.status(201).json(copy);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle Favorite Status
router.post('/favorite/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const template = await Template.findOne({
      where: { id, userId: req.userId }
    });
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    await template.update({ isFavorite: !template.isFavorite });
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Template
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const template = await Template.findOne({
      where: { id, userId: req.userId }
    });
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    await template.destroy();
    res.json({ message: 'Template deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
