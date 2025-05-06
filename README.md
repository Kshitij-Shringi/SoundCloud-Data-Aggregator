# SoundCloud Downloader

A Node.js application for downloading tracks and processing metadata from SoundCloud.

## Prerequisites

- Node.js (v12 or higher)
- npm (Node Package Manager)

## Installation

1. Clone this repository:
```bash
git clone <repository-url>
cd soundcloud
```

2. Install dependencies:
```bash
npm install
```

## Project Structure

- `Download4.js` - Main script for downloading tracks
- `extracted_links.js` - Script for extracting SoundCloud links
- `soundcloud_metadata.csv` - CSV file containing track metadata
- `downloaded_files/` - Directory where downloaded tracks are stored

## Usage

1. To download tracks:
```bash
node Download4.js
```

2. To extract links:
```bash
node extracted_links.js
```

## Features

- Download SoundCloud tracks
- Extract track metadata
- Process and store track information in CSV format

## Dependencies

- soundcloud-downloader

## Notes

- Make sure you have a stable internet connection for downloading tracks
- The application uses the SoundCloud API, so ensure you comply with SoundCloud's terms of service
- Downloaded files are stored in the `downloaded_files` directory
- Metadata is stored in CSV format for easy processing and analysis

## License

ISC

## Contributing

Feel free to submit issues and enhancement requests. 