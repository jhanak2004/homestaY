/**
 * Google Apps Script for StayBook
 * 
 * This script connects your Google Form to the StayBook webhook
 * When a guest submits the form, their response is automatically sent to your app
 * 
 * Installation:
 * 1. Open your Google Form: https://docs.google.com/forms/d/e/1FAIpQLSfU6upslhYQ-jpAUBGXWz8oMrFmRzDSH3il5hzX9UTcAGNnrQ/edit
 * 2. Click ⋮ (menu) → Script editor
 * 3. Delete existing code (if any)
 * 4. Paste this entire script
 * 5. Update the WEBHOOK_URL below with your API endpoint
 * 6. Click "Save" 
 * 7. At the top, select "onFormSubmit" from the function dropdown and click Run
 * 8. Authorize the script when prompted
 * 9. Done! Future form submissions will auto-post to your app
 */

// ✏️ CONFIGURE THESE SETTINGS ✏️
const WEBHOOK_URL = 'https://staybook1404-1704.onrender.com/api/submit-form';
// For local testing, use: 'http://localhost:3002/api/submit-form'

/**
 * Main function: Triggered when form is submitted
 * Extracts all responses and sends to webhook
 */
function onFormSubmit(e) {
  try {
    const response = e.response;
    const itemResponses = response.getItemResponses() || [];

    // Extract booking_id from the form response using multiple strategies
    let booking_id = '';
    const responseData = {};

    function normalizeAnswer(a) {
      if (a === undefined || a === null) return '';
      if (Array.isArray(a)) return a.map(String).join(', ').trim();
      return String(a).trim();
    }

    for (const itemResponse of itemResponses) {
      const itemTitle = itemResponse.getItem().getTitle();
      const rawAnswer = itemResponse.getResponse();
      const itemAnswer = normalizeAnswer(rawAnswer);

      // collect all answers keyed by question title
      if (itemAnswer) responseData[itemTitle] = itemAnswer;

      // 1) if this question title looks like 'booking' assume it's the id
      if (!booking_id && /booking/i.test(itemTitle) && /^[a-f0-9\-]{36}$/i.test(itemAnswer)) {
        booking_id = itemAnswer;
      }

      // 2) if answer itself looks like a UUID, prefer that
      if (!booking_id && /^[a-f0-9\-]{36}$/i.test(itemAnswer)) {
        booking_id = itemAnswer;
      }
    }

    // 3) If still not found, attempt to read prefilled entry param by checking a field titled like the numeric entry hint
    // (Note: Forms do not expose entry.<id> directly; prefilled values appear as answers above.)

    if (!booking_id) {
      logToSheet('⚠️ Missing booking_id', 'No booking_id detected in answers', responseData);
      return; // stop: server requires booking_id to associate response
    }

    // Construct payload and POST to webhook
    const payload = Object.assign({ booking_id }, responseData);

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    let response_http, responseCode, responseText;
    try {
      response_http = UrlFetchApp.fetch(WEBHOOK_URL, options);
      responseCode = response_http.getResponseCode();
      responseText = response_http.getContentText();
    } catch (err) {
      logToSheet('❌ Network Error', 'Failed to POST to webhook', { err: err.toString(), payload });
      console.error('Network error posting webhook:', err);
      return;
    }

    if (responseCode === 200) {
      logToSheet('✅ Success', `Posted to webhook (${responseCode})`, payload);
    } else {
      logToSheet('⚠️ Webhook Error', `Webhook returned ${responseCode}`, { payload, response: responseText });
    }

  } catch (error) {
    logToSheet('❌ Error', error.toString(), { stack: error.stack });
    console.error('Error in onFormSubmit:', error);
  }
}

/**
 * Helper function: Log events to a Google Sheet for debugging
 * This creates a hidden sheet called "Script Logs"
 */
function logToSheet(status, message, data) {
  try {
    const form = FormApp.getActiveForm();
    const destinationId = form && form.getDestinationId ? form.getDestinationId() : '';
    if (!destinationId) return;
    const spreadsheet = SpreadsheetApp.openById(destinationId);
    let logSheet = spreadsheet.getSheetByName('Script Logs');
    
    if (!logSheet) {
      logSheet = spreadsheet.insertSheet('Script Logs');
      logSheet.appendRow(['Timestamp', 'Status', 'Message', 'Data']);
      logSheet.setFrozenRows(1);
    }
    
    const timestamp = new Date().toISOString();
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
    logSheet.appendRow([timestamp, status, message, dataStr.substring(0, 1000)]);
  } catch (e) {
    console.error('Script log failure:', e);
  }
}

/**
 * Test function: Run this to send a test webhook manually
 * Useful for debugging without submitting the form
 */
function testWebhook() {
  const testData = {
    booking_id: '365ffb17-b33e-459c-8ce0-13a196ca861b',
    guest_name: 'Test Guest',
    guest_phone: '9770884337',
    members: '2',
    id_of_members: 'Test verification'
  };
  
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(testData),
    muteHttpExceptions: true,
    timeout: 30
  };
  
  try {
    const response = UrlFetchApp.fetch(WEBHOOK_URL, options);
    console.log(`✅ Test webhook response: ${response.getResponseCode()}`);
    console.log(response.getContentText());
  } catch (error) {
    console.error('❌ Test webhook failed:', error);
  }
}

/**
 * Optional: Create a custom menu in Google Forms
 * Adds a "StayBook" menu to the form editor
 */
function onOpen() {
  FormApp.getUi()
    .createMenu('StayBook')
    .addItem('Test Webhook Connection', 'testWebhook')
    .addItem('View Script Logs', 'openLogs')
    .addToForm();
}

/**
 * Helper: Open the Script Logs sheet
 */
function openLogs() {
  const form = FormApp.getActiveForm();
  const destinationId = form && form.getDestinationId ? form.getDestinationId() : '';
  if (!destinationId) {
    SpreadsheetApp.getUi().showModalDialog(
      SpreadsheetApp.getUi().createHtmlOutput('No form destination spreadsheet found.'),
      'Script Logs'
    );
    return;
  }

  const spreadsheet = SpreadsheetApp.openById(destinationId);
  const logSheet = spreadsheet.getSheetByName('Script Logs');
  
  if (logSheet) {
    SpreadsheetApp.getUi().showToast('Script Logs sheet ready');
  } else {
    SpreadsheetApp.getUi().showModalDialog(
      SpreadsheetApp.getUi().createHtmlOutput('No logs yet. Submit a form response or run Test Webhook.'),
      'Script Logs'
    );
  }
}
