/**
 * Firebase Storage Image Downloader
 * 
 * This script downloads all images from your Firebase Storage to a local folder.
 * 
 * SETUP INSTRUCTIONS:
 * 1. Install required packages: npm install firebase-admin
 * 2. Download your Firebase Admin SDK key:
 *    - Go to Firebase Console > Project Settings > Service Accounts
 *    - Click "Generate new private key"
 *    - Save the JSON file as "serviceAccountKey.json" in this folder
 * 3. Run the script: node download-images.js
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Firebase configuration
const STORAGE_BUCKET = 'oda-pap-46469.appspot.com';

// Folder to download from (only listings)
const SOURCE_FOLDER = 'listings';

// Local folder to save downloaded images (all in one place, no subfolders)
const DOWNLOAD_FOLDER = 'C:\\Users\\Admin\\OneDrive\\Documents\\0firebase migration';

// Supported image extensions
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'];

// Initialize Firebase Admin SDK
function initializeFirebase() {
    try {
        // Try to load service account key
        const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
        
        if (!fs.existsSync(serviceAccountPath)) {
            console.error('\n❌ ERROR: serviceAccountKey.json not found!');
            console.log('\n📋 How to get your service account key:');
            console.log('   1. Go to Firebase Console: https://console.firebase.google.com/');
            console.log('   2. Select your project (oda-pap-46469)');
            console.log('   3. Click the gear icon ⚙️ > Project Settings');
            console.log('   4. Go to "Service Accounts" tab');
            console.log('   5. Click "Generate new private key"');
            console.log('   6. Save the downloaded file as "serviceAccountKey.json" in this folder');
            console.log('   7. Run this script again: node download-images.js\n');
            process.exit(1);
        }

        const serviceAccount = require(serviceAccountPath);
        
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            storageBucket: STORAGE_BUCKET
        });
        
        console.log('✅ Firebase initialized successfully');
        return admin.storage().bucket();
    } catch (error) {
        console.error('❌ Error initializing Firebase:', error.message);
        process.exit(1);
    }
}

// Create download folder if it doesn't exist
function ensureDownloadFolder(folderPath) {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
        console.log(`📁 Created folder: ${folderPath}`);
    }
}

// Check if file is an image
function isImage(filename) {
    const ext = path.extname(filename).toLowerCase();
    return IMAGE_EXTENSIONS.includes(ext);
}

// Download a file from URL
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(destPath);
        
        protocol.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                // Handle redirect
                downloadFile(response.headers.location, destPath)
                    .then(resolve)
                    .catch(reject);
                return;
            }
            
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: ${response.statusCode}`));
                return;
            }
            
            response.pipe(file);
            
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(destPath, () => {}); // Delete incomplete file
            reject(err);
        });
    });
}

// Main download function
async function downloadAllImages() {
    console.log('\n🚀 Starting Firebase Storage Listings Downloader\n');
    
    const bucket = initializeFirebase();
    ensureDownloadFolder(DOWNLOAD_FOLDER);
    
    console.log(`📂 Fetching images from "${SOURCE_FOLDER}/" folder...\n`);
    
    try {
        // Get files only from listings folder
        const [files] = await bucket.getFiles({ prefix: SOURCE_FOLDER + '/' });
        
        if (files.length === 0) {
            console.log('📭 No files found in listings folder');
            return;
        }
        
        console.log(`📊 Found ${files.length} total files in listings\n`);
        
        // Filter for images only
        const imageFiles = files.filter(file => isImage(file.name));
        
        console.log(`🖼️  Found ${imageFiles.length} image files to download\n`);
        
        if (imageFiles.length === 0) {
            console.log('📭 No image files found');
            console.log('\nFiles found in storage:');
            files.slice(0, 20).forEach(file => console.log(`   - ${file.name}`));
            if (files.length > 20) console.log(`   ... and ${files.length - 20} more`);
            return;
        }
        
        let downloaded = 0;
        let failed = 0;
        let skipped = 0;
        
        for (const file of imageFiles) {
            try {
                // Get just the filename (no subfolders) - flatten everything
                const originalName = path.basename(file.name);
                
                // To avoid name conflicts, prefix with a unique identifier
                const uniquePrefix = file.name
                    .replace(SOURCE_FOLDER + '/', '')
                    .replace(/\//g, '_')
                    .replace(originalName, '');
                
                const localFileName = uniquePrefix + originalName;
                const localPath = path.join(DOWNLOAD_FOLDER, localFileName);
                
                // Check if file already exists
                if (fs.existsSync(localPath)) {
                    console.log(`⏭️  Skipped (exists): ${localFileName}`);
                    skipped++;
                    continue;
                }
                
                // Get signed URL for download
                const [signedUrl] = await file.getSignedUrl({
                    action: 'read',
                    expires: Date.now() + 15 * 60 * 1000 // 15 minutes
                });
                
                // Download the file
                await downloadFile(signedUrl, localPath);
                
                downloaded++;
                console.log(`✅ Downloaded (${downloaded}/${imageFiles.length}): ${localFileName}`);
                
            } catch (error) {
                failed++;
                console.error(`❌ Failed: ${file.name} - ${error.message}`);
            }
        }
        
        console.log('\n' + '='.repeat(50));
        console.log('📊 DOWNLOAD SUMMARY');
        console.log('='.repeat(50));
        console.log(`✅ Successfully downloaded: ${downloaded}`);
        console.log(`⏭️  Skipped (already exist): ${skipped}`);
        console.log(`❌ Failed: ${failed}`);
        console.log(`📁 Download location: ${path.resolve(DOWNLOAD_FOLDER)}`);
        console.log('='.repeat(50) + '\n');
        
    } catch (error) {
        console.error('❌ Error fetching files:', error.message);
        process.exit(1);
    }
}

// Run the download
downloadAllImages();
