/**
 * CSV and JSON export generation + download triggering.
 */

const CSV_HEADERS = {
  username: 'Username',
  displayName: 'Display Name',
  bio: 'Bio',
  followersCount: 'Followers',
  followingCount: 'Following',
  verified: 'Verified',
  joinDate: 'Joined',
  location: 'Location',
  profileUrl: 'Profile URL',
  userId: 'User ID',
  profileImageUrl: 'Profile Image URL',
};

function escapeCSV(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate CSV string from user array.
 */
export function generateCSV(users, fields = null) {
  const fieldKeys = fields || Object.keys(CSV_HEADERS);
  const headerRow = fieldKeys.map(k => CSV_HEADERS[k] || k).join(',');
  const dataRows = users.map(user =>
    fieldKeys.map(k => escapeCSV(user[k])).join(',')
  );
  return [headerRow, ...dataRows].join('\n');
}

/**
 * Generate JSON string from user array.
 */
export function generateJSON(users) {
  return JSON.stringify(users, null, 2);
}

/**
 * Trigger a file download using chrome.downloads API.
 */
export async function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });

  // Convert blob to data URL for service worker compatibility
  const reader = new FileReader();
  const dataUrl = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  return chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: true,
  });
}

/**
 * Export users as CSV and trigger download.
 */
export async function exportCSV(users, username, type) {
  const csv = generateCSV(users);
  const filename = `${username}_${type}_${formatTimestamp()}.csv`;
  return downloadFile(csv, filename, 'text/csv');
}

/**
 * Export users as JSON and trigger download.
 */
export async function exportJSON(users, username, type) {
  const json = generateJSON(users);
  const filename = `${username}_${type}_${formatTimestamp()}.json`;
  return downloadFile(json, filename, 'application/json');
}

function formatTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
