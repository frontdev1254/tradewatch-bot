const { google } = require('googleapis');
const path = require('path');

// Authentication using Service Account
const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, '../secrets/tradewatch-key.json'), // Path to the Service Account JSON file
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
  ],
});

const sheets = google.sheets({ version: 'v4', auth });

module.exports = { sheets, auth };