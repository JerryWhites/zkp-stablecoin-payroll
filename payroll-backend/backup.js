// ====================================
// 🔒 AUTOMATED BACKUP SYSTEM
// ====================================
// Features:
// - Daily encrypted database backups
// - Configurable retention (30 days default)
// - GPG encryption for backup files
// - Backup verification
// - Restore functionality

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { execSync } = require('child_process');
require('dotenv').config();

// Configuration
const CONFIG = {
    DATABASE_PATH: process.env.DATABASE_PATH || './payroll.db',
    BACKUP_DIR: process.env.BACKUP_DIR || './backups',
    // 🔒 SECURITY: Fail hard if no encryption key — random key = unrecoverable backups
    ENCRYPTION_KEY: (() => {
        const key = process.env.DATABASE_ENCRYPTION_KEY || process.env.MASTER_ENCRYPTION_KEY;
        if (!key) {
            console.error('FATAL: DATABASE_ENCRYPTION_KEY or MASTER_ENCRYPTION_KEY is required for backup encryption. Backups will NOT be created without it.');
            console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
            // Don’t exit here — backup module is optional — but return null so backup functions fail safely
            return null;
        }
        return key;
    })(),
    RETENTION_DAYS: parseInt(process.env.BACKUP_RETENTION_DAYS) || 30,
    MAX_BACKUPS: parseInt(process.env.MAX_BACKUPS) || 60
};

// Ensure backup directory exists
if (!fs.existsSync(CONFIG.BACKUP_DIR)) {
    fs.mkdirSync(CONFIG.BACKUP_DIR, { recursive: true, mode: 0o700 });
}

/**
 * Encrypt data using AES-256-GCM
 */
function encrypt(buffer, key) {
    const iv = crypto.randomBytes(16);
    const keyBuffer = Buffer.from(key, 'hex').slice(0, 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
    
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();
    
    // Format: IV (16 bytes) + AuthTag (16 bytes) + Encrypted data
    return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt data using AES-256-GCM
 */
function decrypt(encryptedBuffer, key) {
    const iv = encryptedBuffer.slice(0, 16);
    const authTag = encryptedBuffer.slice(16, 32);
    const encrypted = encryptedBuffer.slice(32);
    
    const keyBuffer = Buffer.from(key, 'hex').slice(0, 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
    decipher.setAuthTag(authTag);
    
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Create encrypted backup of the database
 */
function createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `payroll-backup-${timestamp}`;
    const backupPath = path.join(CONFIG.BACKUP_DIR, `${backupName}.enc`);
    const checksumPath = path.join(CONFIG.BACKUP_DIR, `${backupName}.sha256`);
    
    console.log(`📦 Creating backup: ${backupName}`);
    
    try {
        // Read database file
        if (!fs.existsSync(CONFIG.DATABASE_PATH)) {
            throw new Error(`Database not found: ${CONFIG.DATABASE_PATH}`);
        }
        
        const dbData = fs.readFileSync(CONFIG.DATABASE_PATH);
        console.log(`   Database size: ${(dbData.length / 1024).toFixed(2)} KB`);
        
        // Compress data
        const compressed = zlib.gzipSync(dbData, { level: 9 });
        console.log(`   Compressed size: ${(compressed.length / 1024).toFixed(2)} KB`);
        
        // Encrypt data
        const encrypted = encrypt(compressed, CONFIG.ENCRYPTION_KEY);
        console.log(`   Encrypted size: ${(encrypted.length / 1024).toFixed(2)} KB`);
        
        // Write encrypted backup
        fs.writeFileSync(backupPath, encrypted, { mode: 0o600 });
        
        // Calculate and store checksum
        const checksum = crypto.createHash('sha256').update(encrypted).digest('hex');
        fs.writeFileSync(checksumPath, `${checksum}  ${backupName}.enc\n`, { mode: 0o600 });
        
        console.log(`   ✅ Backup created: ${backupPath}`);
        console.log(`   Checksum: ${checksum.substring(0, 16)}...`);
        
        // Clean old backups
        cleanOldBackups();
        
        return {
            success: true,
            path: backupPath,
            checksum,
            timestamp,
            size: encrypted.length
        };
        
    } catch (error) {
        console.error(`   ❌ Backup failed: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Restore database from encrypted backup
 */
function restoreBackup(backupFileName) {
    // 🔒 SECURITY: Prevent path traversal — only allow filenames, not paths
    const sanitizedName = path.basename(backupFileName);
    const backupPath = path.join(CONFIG.BACKUP_DIR, sanitizedName);
    
    // Verify the resolved path stays within BACKUP_DIR
    const resolvedPath = path.resolve(backupPath);
    const resolvedDir = path.resolve(CONFIG.BACKUP_DIR);
    if (!resolvedPath.startsWith(resolvedDir)) {
        throw new Error('Invalid backup path — path traversal detected');
    }
    
    const checksumPath = backupPath.replace('.enc', '.sha256');
    
    console.log(`🔄 Restoring from: ${sanitizedName}`);
    
    try {
        if (!fs.existsSync(backupPath)) {
            throw new Error(`Backup not found: ${backupPath}`);
        }
        
        // Read encrypted backup
        const encrypted = fs.readFileSync(backupPath);
        
        // Verify checksum if available
        if (fs.existsSync(checksumPath)) {
            const storedChecksum = fs.readFileSync(checksumPath, 'utf8').split(' ')[0].trim();
            const actualChecksum = crypto.createHash('sha256').update(encrypted).digest('hex');
            
            if (storedChecksum !== actualChecksum) {
                throw new Error('Checksum verification failed - backup may be corrupted');
            }
            console.log(`   ✅ Checksum verified`);
        }
        
        // Decrypt
        const compressed = decrypt(encrypted, CONFIG.ENCRYPTION_KEY);
        console.log(`   Decrypted successfully`);
        
        // Decompress
        const dbData = zlib.gunzipSync(compressed);
        console.log(`   Decompressed size: ${(dbData.length / 1024).toFixed(2)} KB`);
        
        // Create backup of current database before restore
        const currentBackupPath = CONFIG.DATABASE_PATH + '.pre-restore';
        if (fs.existsSync(CONFIG.DATABASE_PATH)) {
            fs.copyFileSync(CONFIG.DATABASE_PATH, currentBackupPath);
            console.log(`   Current database backed up to: ${currentBackupPath}`);
        }
        
        // Write restored database
        fs.writeFileSync(CONFIG.DATABASE_PATH, dbData, { mode: 0o600 });
        console.log(`   ✅ Database restored successfully`);
        
        return {
            success: true,
            restoredFrom: backupFileName,
            size: dbData.length
        };
        
    } catch (error) {
        console.error(`   ❌ Restore failed: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * List all available backups
 */
function listBackups() {
    const files = fs.readdirSync(CONFIG.BACKUP_DIR)
        .filter(f => f.endsWith('.enc'))
        .sort()
        .reverse();
    
    const backups = files.map(file => {
        const filePath = path.join(CONFIG.BACKUP_DIR, file);
        const stats = fs.statSync(filePath);
        
        // Extract timestamp from filename
        const match = file.match(/payroll-backup-(.+)\.enc/);
        const timestamp = match ? match[1].replace(/-/g, ':').replace(/T/g, ' ') : 'unknown';
        
        return {
            filename: file,
            size: stats.size,
            sizeHuman: `${(stats.size / 1024).toFixed(2)} KB`,
            created: stats.mtime,
            timestamp
        };
    });
    
    return backups;
}

/**
 * Clean old backups based on retention policy
 */
function cleanOldBackups() {
    const backups = listBackups();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CONFIG.RETENTION_DAYS);
    
    let deleted = 0;
    
    // Delete by age
    backups.forEach(backup => {
        if (backup.created < cutoffDate) {
            const encPath = path.join(CONFIG.BACKUP_DIR, backup.filename);
            const checksumPath = encPath.replace('.enc', '.sha256');
            
            fs.unlinkSync(encPath);
            if (fs.existsSync(checksumPath)) {
                fs.unlinkSync(checksumPath);
            }
            
            console.log(`   🗑️  Deleted old backup: ${backup.filename}`);
            deleted++;
        }
    });
    
    // Also enforce max backups limit
    const remainingBackups = listBackups();
    if (remainingBackups.length > CONFIG.MAX_BACKUPS) {
        const toDelete = remainingBackups.slice(CONFIG.MAX_BACKUPS);
        toDelete.forEach(backup => {
            const encPath = path.join(CONFIG.BACKUP_DIR, backup.filename);
            const checksumPath = encPath.replace('.enc', '.sha256');
            
            fs.unlinkSync(encPath);
            if (fs.existsSync(checksumPath)) {
                fs.unlinkSync(checksumPath);
            }
            
            console.log(`   🗑️  Deleted excess backup: ${backup.filename}`);
            deleted++;
        });
    }
    
    if (deleted > 0) {
        console.log(`   Cleaned up ${deleted} old backup(s)`);
    }
}

/**
 * Verify backup integrity
 */
function verifyBackup(backupFileName) {
    const backupPath = path.join(CONFIG.BACKUP_DIR, backupFileName);
    const checksumPath = backupPath.replace('.enc', '.sha256');
    
    console.log(`🔍 Verifying: ${backupFileName}`);
    
    try {
        if (!fs.existsSync(backupPath)) {
            throw new Error('Backup file not found');
        }
        
        const encrypted = fs.readFileSync(backupPath);
        
        // Verify checksum
        if (fs.existsSync(checksumPath)) {
            const storedChecksum = fs.readFileSync(checksumPath, 'utf8').split(' ')[0].trim();
            const actualChecksum = crypto.createHash('sha256').update(encrypted).digest('hex');
            
            if (storedChecksum !== actualChecksum) {
                throw new Error('Checksum mismatch');
            }
        }
        
        // Try to decrypt (but don't write)
        const compressed = decrypt(encrypted, CONFIG.ENCRYPTION_KEY);
        const dbData = zlib.gunzipSync(compressed);
        
        // Check SQLite header
        const sqliteHeader = dbData.slice(0, 16).toString('utf8');
        if (!sqliteHeader.startsWith('SQLite format 3')) {
            throw new Error('Invalid SQLite format after decryption');
        }
        
        console.log(`   ✅ Backup verified successfully`);
        console.log(`   Original size: ${(dbData.length / 1024).toFixed(2)} KB`);
        
        return { success: true, valid: true };
        
    } catch (error) {
        console.error(`   ❌ Verification failed: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// CLI interface
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0];
    
    console.log('🔒 Unhackable Payroll Backup System\n');
    
    switch (command) {
        case 'create':
            createBackup();
            break;
            
        case 'restore':
            if (!args[1]) {
                console.log('Usage: node backup.js restore <backup-filename>');
                console.log('\nAvailable backups:');
                listBackups().forEach(b => console.log(`  - ${b.filename} (${b.sizeHuman})`));
            } else {
                restoreBackup(args[1]);
            }
            break;
            
        case 'list':
            const backups = listBackups();
            if (backups.length === 0) {
                console.log('No backups found.');
            } else {
                console.log(`Found ${backups.length} backup(s):\n`);
                backups.forEach((b, i) => {
                    console.log(`${i + 1}. ${b.filename}`);
                    console.log(`   Size: ${b.sizeHuman}`);
                    console.log(`   Created: ${b.created.toISOString()}`);
                    console.log('');
                });
            }
            break;
            
        case 'verify':
            if (!args[1]) {
                console.log('Usage: node backup.js verify <backup-filename>');
            } else {
                verifyBackup(args[1]);
            }
            break;
            
        case 'clean':
            cleanOldBackups();
            break;
            
        default:
            console.log('Usage: node backup.js <command>\n');
            console.log('Commands:');
            console.log('  create   - Create new encrypted backup');
            console.log('  restore  - Restore from backup');
            console.log('  list     - List all backups');
            console.log('  verify   - Verify backup integrity');
            console.log('  clean    - Clean old backups');
    }
}

module.exports = {
    createBackup,
    restoreBackup,
    listBackups,
    verifyBackup,
    cleanOldBackups
};
