const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * NotificationMonitor attempts to read macOS Notification Center data.
 * WARNING: On modern macOS (Big Sur and later), the Notification Center DB
 * is protected by System Integrity Protection (SIP) and requires Full Disk Access.
 */
class NotificationMonitor {
  constructor() {
    this.notifications = [];
  }

  /**
   * Attempt to read recent notifications from the macOS SQLite DB.
   * This is a best-effort approach.
   * @returns {Array} Array of notification objects
   */
  getRecentNotifications() {
    try {
      // Find the notification DB path (varies by user/OS)
      const dbDir = execSync('getconf DARWIN_USER_DIR').toString().trim() + 'com.apple.notificationcenter/db2/';
      const dbPath = path.join(dbDir, 'db');

      if (!fs.existsSync(dbPath)) {
        return [{ error: "Notification DB not found or accessible." }];
      }

      // Copy the DB to a temp location to avoid locking issues
      const tempDb = path.join('/tmp', 'jarvis_notif_temp.db');
      fs.copyFileSync(dbPath, tempDb);

      // Execute a quick sqlite3 query to get recent records
      // The schema varies heavily across macOS versions. This is a simplified example.
      const query = `
        SELECT app.identifier, record.title, record.body, record.presented 
        FROM record 
        JOIN app ON record.app_id = app.app_id 
        ORDER BY record.presented DESC LIMIT 10;
      `;
      
      const result = execSync(`sqlite3 -json ${tempDb} "${query}"`).toString();
      fs.unlinkSync(tempDb);

      return JSON.parse(result);
    } catch (err) {
      console.error("Failed to read notifications:", err.message);
      return [];
    }
  }

  /**
   * Format notifications into a summary string for the AI Agent
   * @returns {string}
   */
  getAIContextString() {
    const notifs = this.getRecentNotifications();
    if (notifs.length === 0) return "No recent system notifications.";
    if (notifs[0]?.error) return "Cannot read notifications due to OS permission restrictions.";

    const lines = notifs.map(n => `- From [${n.identifier}]: "${n.title || ''}" - ${n.body || ''}`);
    return "Recent Notifications:\n" + lines.join("\n");
  }
}

module.exports = new NotificationMonitor();
