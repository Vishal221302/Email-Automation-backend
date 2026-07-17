import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import User from './User.js';

const ConnectedAccount = sequelize.define('ConnectedAccount', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      isEmail: true
    }
  },
  status: {
    type: DataTypes.STRING, // 'connected' | 'expired' | 'syncing' | 'pending_auth'
    defaultValue: 'connected'
  },
  connectionType: {
    type: DataTypes.STRING,
    defaultValue: 'Gmail OAuth'
  },
  isPrimary: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  lastSync: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  clientId: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  clientSecret: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  refreshToken: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  displayName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  profilePicture: {
    type: DataTypes.TEXT,
    allowNull: true
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
  timestamps: true
});

// Associations
User.hasMany(ConnectedAccount, { foreignKey: 'userId', as: 'accounts' });
ConnectedAccount.belongsTo(User, { foreignKey: 'userId', as: 'user' });

export default ConnectedAccount;
