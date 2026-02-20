const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Set OpenSSL path
process.env.OPENSSL_CONF = 'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.cfg';
process.env.PATH = `C:\\Program Files\\OpenSSL-Win64\\bin;${process.env.PATH}`;

const certsDir = path.join(__dirname, 'certs');
const keyPath = path.join(certsDir, 'key.pem');
const certPath = path.join(certsDir, 'cert.pem');

// Create certs directory if it doesn't exist
if (!fs.existsSync(certsDir)) {
  fs.mkdirSync(certsDir, { recursive: true });
  console.log(`Created certificates directory: ${certsDir}`);
}

// Check if certificates already exist
if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  console.log('Certificates already exist');
  process.exit(0);
}

console.log('Generating self-signed certificates...');

// Generate private key
try {
  execSync(`openssl genrsa -out "${keyPath}" 2048`);
  console.log('✅ Private key generated successfully');
  
  // Generate self-signed certificate
  execSync(`openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days 365 -subj "/CN=http://fin.blacksky.su/" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`);
  console.log('✅ Certificate generated successfully');
  
  console.log('\n✅ Certificates successfully generated:');
  console.log(`- Private key: ${keyPath}`);
  console.log(`- Certificate: ${certPath}`);
  console.log('\nℹ️  Note: These are self-signed certificates for development only.');
  console.log('   For production, use certificates from a trusted certificate authority (e.g., Let\'s Encrypt).');
} catch (error) {
  console.error('Error generating certificates:');
  console.error(error.message);
  process.exit(1);
}
