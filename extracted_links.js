const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

const inputFile = path.join(__dirname, 'soundcloud_metadata.csv');
const outputFile = path.join(__dirname, 'file.txt');

const links = new Set(); // Use Set to avoid duplicates

// First, check if the input file exists
if (!fs.existsSync(inputFile)) {
    console.error('Input CSV file not found!');
    process.exit(1);
}

let rowCount = 0;

fs.createReadStream(inputFile, { encoding: 'utf-8' })
    .on('error', (error) => {
        console.error('Error reading file:', error);
        process.exit(1);
    })
    .pipe(csv())
    .on('data', (row) => {
        rowCount++;
        // Specifically extract the permalink_url
        if (row.permalink_url && row.permalink_url.includes('soundcloud.com')) {
            links.add(row.permalink_url);
        }
        
        if (rowCount % 10000 === 0) {
            console.log(`Processed ${rowCount} rows...`);
        }
    })
    .on('end', () => {
        const linksArray = Array.from(links);
        fs.writeFileSync(outputFile, linksArray.join('\n'));
        console.log(`\nProcessing complete!`);
        console.log(`Total rows processed: ${rowCount}`);
        console.log(`Total unique links extracted: ${links.size}`);
        console.log(`Links saved to: ${outputFile}`);
    })
    .on('error', (error) => {
        console.error('Error parsing CSV:', error);
        process.exit(1);
    });