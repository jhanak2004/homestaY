# 🔗 Connect Google Form to StayBook App

Follow these steps to automatically send guest responses from Google Form to your StayBook app.

---

## Step 1: Open Google Form Script Editor

1. Go to your Google Form: https://docs.google.com/forms/d/e/1FAIpQLSc_sb8PiDDk7rjTdnLtV-Nclg1KMkE1OXX7OSisab1VicFnAw/edit
2. Click the **⋮ (three dots menu)** at the top right
3. Select **Script editor**

A new tab will open with Google Apps Script editor.

---

## Step 2: Paste the Script

1. **Delete** any existing code in the editor
2. **Copy-paste** the entire script from: `GOOGLE_APPS_SCRIPT.js` (in your project folder)
3. Click **Save** (Ctrl+S or Cmd+S)

You'll see a "Project name" dialog. You can name it "StayBook Webhook" or just click Save.

---

## Step 3: Authorize the Script

1. At the top, select the function dropdown and choose **`onFormSubmit`**
2. Click the **▶️ Run** button
3. A dialog will appear asking for permissions - click **Review permissions**
4. Select your Google Account
5. Click **Allow**

---

## Step 4: Enable Form Trigger (Automatic)

The script needs to run automatically when someone submits the form:

1. On the left sidebar, click the **⏱️ Triggers** icon
2. Click **Create new trigger** at the bottom right
3. Configure:
   - **Choose which function to run:** `onFormSubmit`
   - **Which deployment should be used:** Head
   - **Select event type:** On form submit
   - Click **Save**

---

## Step 5: Test It! 

### Test Option A: From Google Form
1. Go back to your Google Form
2. Click the **Preview** button (eye icon)
3. Fill out the form with test data
4. Submit
5. Go to your app (http://localhost:3002 or https://homestay-2zyf.onrender.com)
6. Open the booking detail for "rahil" (16-18 May)
7. Scroll to "Form Responses" section
8. **You should see your test response!** ✅

### Test Option B: From Google Apps Script
1. In the Apps Script editor, select `testWebhook` from function dropdown
2. Click **▶️ Run**
3. Check your app's "Form Responses" section
4. You should see the test response appear ✅

---

## ✅ How It Works

When a guest fills the Google Form:

1. Guest fills form fields (Name, Phone, Members, etc.)
2. Guest clicks Submit
3. Google Form shows "Your response has been recorded"
4. **Apps Script automatically captures the response**
5. **Sends a POST request to:** `https://homestay-2zyf.onrender.com/api/submit-form`
6. **Response appears instantly in your app's booking detail!**

---

## 🐛 Debugging

If responses don't appear in your app:

1. In Apps Script editor, go to the **Logs** (View → Logs)
2. Check for any error messages
3. Or check the "Script Logs" sheet in your form's response spreadsheet
4. The script will show success/error status for each submission

---

## 📝 Important Notes

- The booking ID field in your Google Form must use this prefill field: **entry.652174934**
- The example test booking ID is **BK1001**; it must exist in MongoDB for a webhook test to be accepted.
- The webhook URL in the script is set to your Render deployment: `https://homestay-2zyf.onrender.com/api/submit-form`
- For local testing, temporarily change it to: `http://localhost:3002/api/submit-form`
- Each form submission automatically creates a new response entry in your app

---

## 🎯 Final Checklist

- [ ] Opened Google Form in editor
- [ ] Pasted the script from GOOGLE_APPS_SCRIPT.js
- [ ] Clicked Save
- [ ] Authorized the script
- [ ] Created the form submit trigger
- [ ] Tested by filling form
- [ ] Saw response appear in app ✅

**Done!** Your Google Form is now connected to StayBook! 🎉
