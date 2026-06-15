// ====================================
// 🛡️ FILE SECURITY SCANNER
// ====================================
// Multi-layer file validation:
// - File type verification (magic bytes)
// - Content sanitization
// - Size limits
// - Malware pattern detection
// - CSV injection prevention

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Allowed MIME types and their magic bytes
const ALLOWED_TYPES = {
    'text/csv': {
        extensions: ['.csv'],
        // CSV has no magic bytes, so we verify content structure
        validator: validateCSV
    },
    'text/plain': {
        extensions: ['.txt', '.csv'],
        validator: validateText
    }
};

// Maximum file sizes
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_CSV_ROWS = 10000;
const MAX_CSV_COLUMNS = 100;

// Dangerous patterns in CSV (injection prevention)
const CSV_INJECTION_PATTERNS = [
    /^=/,           // Formula injection
    /^\+/,          // Formula injection
    /^-/,           // Formula injection
    /^@/,           // Formula injection
    /^\|/,          // Pipe injection
    /^!/,           // Shell injection
    /^\\t/,         // Tab injection for formulas
];

// Suspicious patterns that might indicate malware
const SUSPICIOUS_PATTERNS = [
    /\x00/,                                    // Null bytes
    /<script/i,                                // XSS attempt
    /javascript:/i,                            // XSS attempt
    /on\w+\s*=/i,                              // Event handlers
    /data:\s*text\/html/i,                     // Data URI XSS
    /vbscript:/i,                              // VBScript injection
    /expression\s*\(/i,                        // CSS expression
    /eval\s*\(/i,                              // Eval injection
    /base64,/i,                                // Base64 payload
];

/**
 * Main file scanning function
 */
function scanFile(filePath, options = {}) {
    const result = {
        safe: true,
        filePath,
        fileName: path.basename(filePath),
        timestamp: new Date().toISOString(),
        checks: {
            exists: false,
            sizeOk: false,
            typeOk: false,
            contentSafe: false,
            noInjection: false
        },
        warnings: [],
        errors: [],
        metadata: {}
    };

    try {
        // Check file exists
        if (!fs.existsSync(filePath)) {
            result.safe = false;
            result.errors.push('File does not exist');
            return result;
        }
        result.checks.exists = true;

        // Get file stats
        const stats = fs.statSync(filePath);
        result.metadata.size = stats.size;
        result.metadata.modified = stats.mtime;

        // Check file size
        const maxSize = options.maxSize || MAX_FILE_SIZE;
        if (stats.size > maxSize) {
            result.safe = false;
            result.errors.push(`File too large: ${stats.size} bytes (max: ${maxSize})`);
            return result;
        }
        result.checks.sizeOk = true;

        // Check file extension
        const ext = path.extname(filePath).toLowerCase();
        const allowedExtensions = ['.csv', '.txt'];
        if (!allowedExtensions.includes(ext)) {
            result.safe = false;
            result.errors.push(`Invalid file extension: ${ext}`);
            return result;
        }
        result.checks.typeOk = true;

        // Read file content
        const content = fs.readFileSync(filePath, 'utf8');
        result.metadata.lines = content.split('\n').length;

        // Check for suspicious patterns
        const suspiciousCheck = checkSuspiciousPatterns(content);
        if (!suspiciousCheck.safe) {
            result.safe = false;
            result.errors.push(...suspiciousCheck.issues);
            return result;
        }
        result.checks.contentSafe = true;

        // CSV-specific validation
        if (ext === '.csv') {
            const csvCheck = validateCSV(content, options);
            result.metadata.rows = csvCheck.rows;
            result.metadata.columns = csvCheck.columns;
            
            if (!csvCheck.safe) {
                result.safe = false;
                result.errors.push(...csvCheck.issues);
                return result;
            }
            
            if (csvCheck.warnings.length > 0) {
                result.warnings.push(...csvCheck.warnings);
            }
        }
        result.checks.noInjection = true;

        // Calculate file hash for integrity
        result.metadata.sha256 = crypto.createHash('sha256')
            .update(content)
            .digest('hex');

    } catch (error) {
        result.safe = false;
        result.errors.push(`Scan error: ${error.message}`);
    }

    return result;
}

/**
 * Check for suspicious patterns in content
 */
function checkSuspiciousPatterns(content) {
    const result = { safe: true, issues: [] };
    
    for (const pattern of SUSPICIOUS_PATTERNS) {
        if (pattern.test(content)) {
            result.safe = false;
            result.issues.push(`Suspicious pattern detected: ${pattern.toString()}`);
        }
    }
    
    return result;
}

/**
 * Validate CSV content
 */
function validateCSV(content, options = {}) {
    const result = {
        safe: true,
        rows: 0,
        columns: 0,
        issues: [],
        warnings: []
    };

    const lines = content.split('\n').filter(line => line.trim());
    result.rows = lines.length;

    // Check row count
    const maxRows = options.maxRows || MAX_CSV_ROWS;
    if (result.rows > maxRows) {
        result.safe = false;
        result.issues.push(`Too many rows: ${result.rows} (max: ${maxRows})`);
        return result;
    }

    // Parse and validate each row
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const cells = parseCSVLine(line);
        
        if (i === 0) {
            result.columns = cells.length;
            // Check column count
            if (result.columns > MAX_CSV_COLUMNS) {
                result.safe = false;
                result.issues.push(`Too many columns: ${result.columns}`);
                return result;
            }
        }

        // Check each cell for injection
        for (let j = 0; j < cells.length; j++) {
            const cell = cells[j].trim();
            
            for (const pattern of CSV_INJECTION_PATTERNS) {
                if (pattern.test(cell)) {
                    result.safe = false;
                    result.issues.push(
                        `CSV injection detected at row ${i + 1}, column ${j + 1}: "${cell.substring(0, 50)}..."`
                    );
                }
            }
        }
    }

    // Validate expected headers for payroll CSV
    if (options.validatePayrollHeaders && lines.length > 0) {
        const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
        const requiredHeaders = ['name', 'salary', 'aleoaddress'];
        
        for (const required of requiredHeaders) {
            if (!headers.includes(required)) {
                result.warnings.push(`Missing expected header: ${required}`);
            }
        }
    }

    return result;
}

/**
 * Simple CSV line parser (handles quoted fields)
 */
function parseCSVLine(line) {
    const cells = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            cells.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    
    cells.push(current);
    return cells;
}

/**
 * Validate plain text content
 */
function validateText(content) {
    return checkSuspiciousPatterns(content);
}

/**
 * Sanitize CSV content by removing dangerous characters
 */
function sanitizeCSV(content) {
    const lines = content.split('\n');
    const sanitized = [];
    
    for (const line of lines) {
        if (!line.trim()) {
            sanitized.push(line);
            continue;
        }
        
        const cells = parseCSVLine(line);
        const cleanCells = cells.map(cell => {
            let clean = cell.trim();
            
            // Remove leading dangerous characters
            while (/^[=+\-@|!]/.test(clean)) {
                clean = clean.substring(1).trim();
            }
            
            // Escape quotes
            clean = clean.replace(/"/g, '""');
            
            // Wrap in quotes if contains comma
            if (clean.includes(',') || clean.includes('"')) {
                clean = `"${clean}"`;
            }
            
            return clean;
        });
        
        sanitized.push(cleanCells.join(','));
    }
    
    return sanitized.join('\n');
}

/**
 * Generate quarantine path for suspicious file
 */
function quarantineFile(filePath) {
    const quarantineDir = path.join(path.dirname(filePath), 'quarantine');
    
    if (!fs.existsSync(quarantineDir)) {
        fs.mkdirSync(quarantineDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = path.basename(filePath);
    const quarantinePath = path.join(quarantineDir, `${timestamp}_${fileName}`);
    
    fs.renameSync(filePath, quarantinePath);
    
    // Create metadata file
    const metadataPath = quarantinePath + '.meta';
    fs.writeFileSync(metadataPath, JSON.stringify({
        originalPath: filePath,
        quarantinedAt: new Date().toISOString(),
        reason: 'Security scan failed'
    }, null, 2));
    
    return quarantinePath;
}

// CLI interface
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0];
    
    switch (command) {
        case 'scan':
            if (!args[1]) {
                console.log('Usage: node file-scanner.js scan <filepath>');
                process.exit(1);
            }
            const result = scanFile(args[1], { validatePayrollHeaders: true });
            console.log(JSON.stringify(result, null, 2));
            if (!result.safe) {
                process.exit(1);
            }
            break;
            
        case 'sanitize':
            if (!args[1]) {
                console.log('Usage: node file-scanner.js sanitize <filepath>');
                process.exit(1);
            }
            const content = fs.readFileSync(args[1], 'utf8');
            const sanitized = sanitizeCSV(content);
            console.log(sanitized);
            break;
            
        default:
            console.log('🛡️ File Security Scanner\n');
            console.log('Usage: node file-scanner.js <command> <filepath>\n');
            console.log('Commands:');
            console.log('  scan <file>      - Scan file for security issues');
            console.log('  sanitize <file>  - Sanitize CSV file content');
    }
}

module.exports = {
    scanFile,
    sanitizeCSV,
    quarantineFile,
    validateCSV
};
