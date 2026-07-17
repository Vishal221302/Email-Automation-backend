import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import User from './User.js';

const ScheduledEmail = sequelize.define('ScheduledEmail', {
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
  scheduledAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  status: {
    type: DataTypes.STRING, // 'pending' | 'paused' | 'cancelled'
    defaultValue: 'pending'
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
  timezone: {
    type: DataTypes.STRING,
    defaultValue: 'UTC'
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
  tableName: 'scheduledemails'
});

User.hasMany(ScheduledEmail, { foreignKey: 'userId', as: 'schedules' });
ScheduledEmail.belongsTo(User, { foreignKey: 'userId', as: 'user' });

export default ScheduledEmail;
