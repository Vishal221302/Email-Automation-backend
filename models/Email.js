import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import User from './User.js';

const Email = sequelize.define('Email', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  to: {
    type: DataTypes.STRING,
    allowNull: false
  },
  candidateName: {
    type: DataTypes.STRING,
    defaultValue: ''
  },
  companyName: {
    type: DataTypes.STRING,
    defaultValue: ''
  },
  jobTitle: {
    type: DataTypes.STRING,
    defaultValue: ''
  },
  subject: {
    type: DataTypes.STRING,
    allowNull: false
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  sentAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  status: {
    type: DataTypes.STRING, // 'sent' | 'failed' | 'draft'
    defaultValue: 'sent'
  },
  fromAccount: {
    type: DataTypes.STRING,
    allowNull: false
  },
  attachments: {
    type: DataTypes.TEXT('long'), // Store as JSON string array (LONGTEXT to support large base64 attachments)
    get() {
      const rawValue = this.getDataValue('attachments');
      return rawValue ? JSON.parse(rawValue) : [];
    },
    set(val) {
      this.setDataValue('attachments', JSON.stringify(val || []));
    }
  },
  openRate: {
    type: DataTypes.INTEGER, // 0 or 1
    defaultValue: 0
  },
  clickRate: {
    type: DataTypes.INTEGER, // 0 or 1
    defaultValue: 0
  },
  errorReason: {
    type: DataTypes.STRING,
    defaultValue: null
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: User,
      key: 'id'
    },
    onDelete: 'CASCADE'
  }
}, {
  timestamps: true,
  tableName: 'emails'
});

User.hasMany(Email, { foreignKey: 'userId', as: 'emails' });
Email.belongsTo(User, { foreignKey: 'userId', as: 'user' });

export default Email;
