import bcrypt from 'bcryptjs';
import User from './models/User.js';
import ConnectedAccount from './models/ConnectedAccount.js';
import Template from './models/Template.js';
import sequelize from './config/database.js';

async function seed() {
  try {
    // Establish connection and verify tables
    await sequelize.sync();
    
    // Check if email already registered
    const existing = await User.findOne({ where: { email: 'vishal@gmail.com' } });
    if (existing) {
      console.log('✔ User vishal@gmail.com already exists in the database.');
      process.exit(0);
    }

    // Encrypt password
    const hashedPassword = await bcrypt.hash('123456', 10);
    
    // Create User record
    const newUser = await User.create({
      name: 'Vishal Patel',
      email: 'vishal@gmail.com',
      password: hashedPassword,
      timezone: 'Asia/Kolkata',
      language: 'en-US'
    });
    console.log('✔ User "Vishal Patel" created successfully.');
    
    // Create associated default Gmail account
    await ConnectedAccount.create({
      email: 'vishal@gmail.com',
      status: 'connected',
      isPrimary: true,
      connectionType: 'Gmail OAuth',
      userId: newUser.id
    });
    console.log('✔ Linked default Gmail account: vishal@gmail.com.');

    // Create default cover letter template
    await Template.create({
      name: 'Frontend Engineer - Standard application',
      category: 'Job Application',
      subject: 'Application for Frontend Engineer Role - Vishal Patel',
      body: `Hi Hiring Team,\n\nMy name is Vishal Patel, and I'm writing to apply for the Frontend Engineer position.\n\nI have extensive experience building scalable modern React dashboards with premium layouts, responsive grids, and advanced animations.\n\nBest regards,\nVishal Patel`,
      attachments: [{ name: 'Vishal_Patel_Resume.pdf', size: '280 KB' }],
      isFavorite: true,
      userId: newUser.id
    });
    console.log('✔ Seeded default cover letter templates.');

    console.log('✔ Seeding complete successfully!');
    process.exit(0);
  } catch (err) {
    console.error('✘ Seeding failed:', err.message);
    process.exit(1);
  }
}

seed();
