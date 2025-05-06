const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const scdl = require("soundcloud-downloader").default;

// Configuration
const CLIENT_ID = "KKzJxmw11tYpCs6T24P4uUYhqmjalG6M";
const CSV_PATH = "./soundcloud_metadata.csv";
const DOWNLOAD_DIR = path.join(process.env.HOME, "Desktop", "Soundcloud" , "downloaded_files");
const ERROR_LOG_PATH = path.join(DOWNLOAD_DIR, 'download_errors.log');

const DOWNLOAD_DELAY = 1000; // Delay between batches
const CONCURRENCY = 25; // Number of parallel downloads per batch
const MIN_FILE_SIZE_BYTES = 256 * 1024; // 256 KB minimum file size
const MAX_DOWNLOAD_ATTEMPTS = 3; // Max retries for each track

// Cache to avoid repeated file system operations
const existingFilesCache = new Set();
let cacheInitialized = false;

scdl.setClientID(CLIENT_ID);

// Simple sanitization for better performance
function sanitizeFilename(name) {
  return name.replace(/[/\\?%*:|"<>]/g, "-").trim();
}

function logError(message) {
  const timestamp = new Date().toISOString();
  try {
    fs.appendFileSync(ERROR_LOG_PATH, `${timestamp}: ${message}\n`, { mode: 0o644 });
  } catch (err) {
    // Don't let logging errors stop the script
    console.error(`Failed to log error: ${err.message}`);
  }
}

// Initialize cache of existing files (run once at startup)
function initializeCache() {
  if (cacheInitialized) return;
  
  console.log("Building file cache to speed up processing...");
  try {
    // Build cache of existing files
    if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true, mode: 0o755 });
      cacheInitialized = true;
      return;
    }
    
    const artists = fs.readdirSync(DOWNLOAD_DIR, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    for (const artist of artists) {
      const artistDir = path.join(DOWNLOAD_DIR, artist);
      const files = fs.readdirSync(artistDir);
      
      for (const file of files) {
        const filePath = path.join(artistDir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.isFile() && stats.size >= MIN_FILE_SIZE_BYTES) {
          existingFilesCache.add(`${artist}/${file}`);
        }
      }
    }
    
    console.log(`File cache built with ${existingFilesCache.size} existing files`);
    cacheInitialized = true;
  } catch (err) {
    console.error(`Error building file cache: ${err.message}`);
    logError(`Error building file cache: ${err.message}`);
    // Continue without cache if we can't build it
    cacheInitialized = true;
  }
}

function validateDownloadedFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size >= MIN_FILE_SIZE_BYTES;
  } catch (err) {
    return false;
  }
}

async function downloadTrack(row, index, total, attempts = 0) {
  const artist = sanitizeFilename(row.artist_username);
  const title = sanitizeFilename(row.title);
  const url = row.permalink_url;
  const filenameWithExt = `${title}.mp3`;
  const cacheKey = `${artist}/${filenameWithExt}`;

  // Fast path: check cache first
  if (existingFilesCache.has(cacheKey)) {
    console.log(`[${index + 1}/${total}] Skipping existing valid file: ${cacheKey}`);
    return true;
  }

  const artistDir = path.join(DOWNLOAD_DIR, artist);
  if (!fs.existsSync(artistDir)) {
    fs.mkdirSync(artistDir, { recursive: true, mode: 0o755 });
  }

  const filePath = path.join(artistDir, filenameWithExt);

  // Slower path: check filesystem as fallback
  if (fs.existsSync(filePath) && validateDownloadedFile(filePath)) {
    console.log(`[${index + 1}/${total}] Skipping existing valid file: ${cacheKey}`);
    existingFilesCache.add(cacheKey); // Add to cache for future
    return true;
  }

  // Clean up any invalid file
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    // Just log and continue if we can't delete
    logError(`Failed to delete invalid file ${filePath}: ${err.message}`);
  }

  try {
    console.log(`[${index + 1}/${total}] Downloading: ${artist} - ${title}`);
    const stream = await scdl.download(url);
    const writer = fs.createWriteStream(filePath, { mode: 0o644 });
    
    await new Promise((resolve, reject) => {
      stream.pipe(writer);
      
      writer.on("finish", () => {
        // Validate file after download
        if (validateDownloadedFile(filePath)) {
          console.log(`[${index + 1}/${total}] Downloaded: ${cacheKey}`);
          existingFilesCache.add(cacheKey); // Add to cache
          resolve(true);
        } else {
          try {
            fs.unlinkSync(filePath);
          } catch (unlinkErr) {
            // Just log and continue
          }
          reject(new Error('Downloaded file is too small'));
        }
      });

      writer.on("error", reject);
      stream.on("error", reject);
    });

    return true;
  } catch (err) {
    console.error(`Error downloading ${url}: ${err.message}`);
    logError(`Download failed for ${url}: ${err.message}`);

    // Safely try to remove partial download
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (unlinkErr) {
      // Just log and continue
    }

    // Retry download with exponential backoff
    if (attempts < MAX_DOWNLOAD_ATTEMPTS) {
      const delay = Math.pow(2, attempts) * 1000; // Exponential backoff
      console.log(`Retrying download (Attempt ${attempts + 1}): ${artist} - ${title}`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return downloadTrack(row, index, total, attempts + 1);
    }

    return false;
  }
}

async function processBatch(batch, globalIndexOffset, total) {
  const promises = batch.map((row, indexInBatch) => 
    downloadTrack(row, globalIndexOffset + indexInBatch, total)
  );
  return Promise.all(promises);
}

async function main() {
  // Initialize the existing files cache
  initializeCache();

  // Ensure download directory exists with proper permissions
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true, mode: 0o755 });
  }

  // Ensure error log file exists
  if (!fs.existsSync(ERROR_LOG_PATH)) {
    fs.writeFileSync(ERROR_LOG_PATH, 'SoundCloud Download Error Log\n', { mode: 0o644 });
  }

  const rows = [];

  // Read CSV
  return new Promise((resolve, reject) => {
    fs.createReadStream(CSV_PATH)
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", async () => {
        console.log(`Found ${rows.length} tracks in CSV`);
        
        const total = rows.length;
        const failedTracks = [];

        for (let i = 0; i < rows.length; i += CONCURRENCY) {
          const batch = rows.slice(i, i + CONCURRENCY);
          const batchResults = await processBatch(batch, i, total);
          
          // Track failed downloads
          batchResults.forEach((success, index) => {
            if (!success) {
              failedTracks.push(batch[index]);
            }
          });
          
          // Rate limiting between batches
          if (i + CONCURRENCY < rows.length) {
            await new Promise(resolve => setTimeout(resolve, DOWNLOAD_DELAY));
          }

          // Calculate progress
          const processed = Math.min(i + CONCURRENCY, rows.length);
          const progress = (processed / rows.length) * 100;
          console.log(`Progress: ${progress.toFixed(2)}% (${processed}/${rows.length})`);
        }

        console.log("Download process completed!");
        
        // Log failed tracks
        if (failedTracks.length > 0) {
          console.log(`\n${failedTracks.length} tracks failed to download.`);
          const failedTracksLogPath = path.join(DOWNLOAD_DIR, 'failed_tracks.csv');
          const failedTracksCsv = failedTracks.map(track => 
            `"${track.artist_username}","${track.title}","${track.permalink_url}"`
          ).join('\n');
          
          fs.writeFileSync(failedTracksLogPath, 
            '"artist_username","title","permalink_url"\n' + failedTracksCsv,
            { mode: 0o644 }
          );
          console.log(`Failed tracks logged to: ${failedTracksLogPath}`);
        }

        console.log(`Check ${ERROR_LOG_PATH} for detailed error information`);
        resolve();
      })
      .on("error", reject);
  });
}

main().catch(err => {
  console.error("Fatal error in download script:", err);
  logError(`Fatal error: ${err.message}`);
  process.exit(1);
});