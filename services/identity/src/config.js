export const CONFIG = {
  port: Number(process.env.PORT || 4001),
  jwtSecret: process.env.JWT_SECRET || 'change-me',
  jwtExpiry: process.env.JWT_EXPIRY || '15m',
  refreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'change-me',
  refreshExpiry: process.env.REFRESH_TOKEN_EXPIRY || '7d',
};
