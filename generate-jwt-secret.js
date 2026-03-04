#!/usr/bin/env node

/**
 * Generate JWT Secret Key
 * Tool để tạo secret key mạnh cho JWT authentication
 */

const crypto = require('crypto');

console.log('🔐 JWT Secret Generator\n');
console.log('═'.repeat(50));

// Generate multiple options
console.log('\nGenerated JWT Secrets (pick one):\n');

for (let i = 1; i <= 3; i++) {
    const secret = crypto.randomBytes(32).toString('base64');
    console.log(`${i}. ${secret}`);
}

console.log('\n' + '═'.repeat(50));
console.log('\n💡 Instructions:');
console.log('   1. Copy one of the secrets above');
console.log('   2. Add to Render Environment Variables:');
console.log('      Key: JWT_SECRET');
console.log('      Value: <paste-the-secret>');
console.log('\n⚠️  Keep this secret safe and never commit to Git!');
console.log('');
