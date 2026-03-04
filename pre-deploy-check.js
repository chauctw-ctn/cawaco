#!/usr/bin/env node

/**
 * Pre-deployment Test Script
 * Kiểm tra các yêu cầu trước khi deploy
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Pre-Deployment Check\n');
console.log('═'.repeat(50));

let passCount = 0;
let failCount = 0;
let warnCount = 0;

function pass(message) {
    console.log(`✅ ${message}`);
    passCount++;
}

function fail(message) {
    console.log(`❌ ${message}`);
    failCount++;
}

function warn(message) {
    console.log(`⚠️  ${message}`);
    warnCount++;
}

// 1. Check Node version
console.log('\n📦 Checking Node.js version...');
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.split('.')[0].slice(1));
if (majorVersion >= 20) {
    pass(`Node.js ${nodeVersion} (>= 20.x)`);
} else {
    fail(`Node.js ${nodeVersion} - Need 20.x or higher`);
}

// 2. Check package.json
console.log('\n📄 Checking package.json...');
try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    
    if (packageJson.name) {
        pass(`Package name: ${packageJson.name}`);
    }
    
    if (packageJson.engines && packageJson.engines.node) {
        pass(`Node engine specified: ${packageJson.engines.node}`);
    } else {
        warn('No Node engine specified in package.json');
    }
    
    if (packageJson.scripts && packageJson.scripts.start) {
        pass(`Start script: ${packageJson.scripts.start}`);
    } else {
        fail('No start script in package.json');
    }
    
    // Check critical dependencies
    const deps = packageJson.dependencies || {};
    const criticalDeps = ['express', 'pg', 'mqtt', 'axios', 'jsonwebtoken'];
    
    criticalDeps.forEach(dep => {
        if (deps[dep]) {
            pass(`Dependency: ${dep}@${deps[dep]}`);
        } else {
            fail(`Missing dependency: ${dep}`);
        }
    });
    
} catch (error) {
    fail(`Cannot read package.json: ${error.message}`);
}

// 3. Check critical files
console.log('\n📁 Checking critical files...');
const criticalFiles = [
    'server.js',
    'config/index.js',
    'modules/database/index.js',
    'modules/mqtt/index.js',
    'modules/tva/index.js',
    'modules/scada/index.js',
    'modules/monre/index.js',
    'render.yaml',
    '.gitignore'
];

criticalFiles.forEach(file => {
    if (fs.existsSync(file)) {
        pass(`File exists: ${file}`);
    } else {
        fail(`Missing file: ${file}`);
    }
});

// 4. Check public files
console.log('\n🌐 Checking public files...');
const publicFiles = [
    'public/index.html',
    'public/stats.html',
    'public/scada.html',
    'public/databtn.html',
    'public/login.html'
];

publicFiles.forEach(file => {
    if (fs.existsSync(file)) {
        pass(`Public file: ${file}`);
    } else {
        warn(`Missing public file: ${file}`);
    }
});

// 5. Check .gitignore
console.log('\n🚫 Checking .gitignore...');
try {
    const gitignore = fs.readFileSync('.gitignore', 'utf8');
    const shouldIgnore = ['node_modules', '.env', 'telegram-config.json'];
    
    shouldIgnore.forEach(pattern => {
        if (gitignore.includes(pattern)) {
            pass(`Ignoring: ${pattern}`);
        } else {
            warn(`Not ignoring: ${pattern} (should be in .gitignore)`);
        }
    });
} catch (error) {
    warn('Cannot read .gitignore');
}

// 6. Check documentation
console.log('\n📖 Checking documentation...');
const docFiles = ['README.md', 'DEPLOYMENT.md', '.env.example'];
docFiles.forEach(file => {
    if (fs.existsSync(file)) {
        pass(`Documentation: ${file}`);
    } else {
        warn(`Missing doc: ${file}`);
    }
});

// 7. Check environment variables template
console.log('\n🔐 Checking environment setup...');
try {
    if (fs.existsSync('.env.example')) {
        const envExample = fs.readFileSync('.env.example', 'utf8');
        const requiredVars = ['DATABASE_URL', 'JWT_SECRET'];
        
        requiredVars.forEach(varName => {
            if (envExample.includes(varName)) {
                pass(`Env template has: ${varName}`);
            } else {
                warn(`Env template missing: ${varName}`);
            }
        });
    }
} catch (error) {
    warn('Cannot check .env.example');
}

// 8. Check render.yaml
console.log('\n☁️  Checking render.yaml...');
try {
    const renderYaml = fs.readFileSync('render.yaml', 'utf8');
    
    if (renderYaml.includes('buildCommand')) {
        pass('Build command configured');
    }
    
    if (renderYaml.includes('startCommand')) {
        pass('Start command configured');
    }
    
    if (renderYaml.includes('healthCheckPath')) {
        pass('Health check configured');
    }
    
    if (renderYaml.includes('DATABASE_URL')) {
        pass('DATABASE_URL in env vars');
    }
    
    if (renderYaml.includes('JWT_SECRET')) {
        pass('JWT_SECRET in env vars');
    }
} catch (error) {
    fail('Cannot read render.yaml');
}

// Summary
console.log('\n' + '═'.repeat(50));
console.log('📊 Summary:');
console.log(`   ✅ Passed:  ${passCount}`);
console.log(`   ⚠️  Warnings: ${warnCount}`);
console.log(`   ❌ Failed:  ${failCount}`);
console.log('═'.repeat(50));

if (failCount === 0 && warnCount === 0) {
    console.log('\n🎉 Everything looks good! Ready to deploy.');
    process.exit(0);
} else if (failCount === 0) {
    console.log('\n⚠️  You can deploy, but consider fixing warnings.');
    process.exit(0);
} else {
    console.log('\n❌ Please fix the failures before deploying.');
    process.exit(1);
}
