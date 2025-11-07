const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

module.exports = {
  SERVER_CONFIG: {
    PORT: process.env.PORT || 3000,
    HOST: process.env.HOST || '0.0.0.0',
    BASE_URL: process.env.BASE_URL || 'http://localhost:3000',
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  },

  DISCORD_CONFIG: {
    CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
    REDIRECT_URI: process.env.DISCORD_REDIRECT_URI,
  },

  DATA_CONFIG: {
    FILE_PATH: process.env.DATA_FILE_PATH || './data/starFinance.json',
  },

  JWT_CONFIG: {
    SECRET: process.env.JWT_SECRET || 'your-super-secure-jwt-secret-key-change-in-production',
    EXPIRY: process.env.TOKEN_EXPIRY || '24h',
  },
};
