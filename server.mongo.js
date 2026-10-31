/**
 * StayBook — MongoDB Server
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3002;
const MONGODB_URI = (process.env.MONGODB_URI || '').trim();
const APP_NAME = process.env.APP_NAME || 'StayBook';
const STORAGE_PREFIX = process.env.STORAGE_PREFIX || 'staybook';
const DEFAULT_PROPERTY_NAME = process.env.PROPERTY_NAME || 'My Property';
const DEFAULT_GOOGLE_FORM_URL = process.env.GOOGLE_FORM_LINK || 'https://docs.google.com/forms/d/e/1FAIpQLSfU6upslhYQ-jpAUBGXWz8oMrFmRzDSH3il5hzX9UTcAGNnrQ/viewform';

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is missing. Set the same MongoDB URI in local .env and Render environment variables.');
  process.exit(1);
}

// ── Google Form Dynamic Link Generator ──────────────────────
const GOOGLE_FORM_ID = '1FAIpQLSfU6upslhYQ-jpAUBGXWz8oMrFmRzDSH3il5hzX9UTcAGNnrQ';
const BOOKING_ID_ENTRY = '1457480287';

function generateFormLink(bookingId) {
  return `https://docs.google.com/forms/d/e/${GOOGLE_FORM_ID}/viewform?usp=pp_url&entry.${BOOKING_ID_ENTRY}=${encodeURIComponent(bookingId)}`;
}

// ── Authentication ──────────────────────────────────────────
const USERS = {
  [process.env.ADMIN_USERNAME || 'admin']: {
    password: process.env.ADMIN_PASSWORD || 'admin123',
    name: process.env.ADMIN_NAME || 'Admin User'
  },
  [process.env.HOST_USERNAME || 'host']: {
    password: process.env.HOST_PASSWORD || 'host123',
    name: process.env.HOST_NAME || 'Host User'
  },
  owner2admin: {
    password: 'owner2pass123',
    name: 'Owner 2 Admin'
  },
  owner2host: {
    password: 'owner2hostpass',
    name: 'Owner 2 Host'
  }
};

const VALID_TOKENS = new Set();

function generateToken() {
  return uuidv4();
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token || !VALID_TOKENS.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

// ── Middleware ──────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const WEBHOOK_LOG_LIMIT = 100;
const webhookLogs = [];

function pushWebhookLog(entry) {
  webhookLogs.unshift({
    at: new Date().toISOString(),
    ...entry
  });
  if (webhookLogs.length > WEBHOOK_LOG_LIMIT) webhookLogs.length = WEBHOOK_LOG_LIMIT;
}

function safeLogPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = { ...payload };
  if (out.password) out.password = '[redacted]';
  if (out.token) out.token = '[redacted]';
  if (out.authorization) out.authorization = '[redacted]';
  return out;
}

function normalizeWebhookPayload(body) {
  const raw = body && typeof body === 'object' ? body : {};

  // Support a few common Apps Script / webhook payload styles.
  const candidates = [
    raw.response_data,
    raw.responseData,
    raw.data,
    raw.payload,
    raw.formData,
    raw.values,
    raw
  ];

  let picked = {};
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      picked = candidate;
      break;
    }
    if (typeof candidate === 'string') {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          picked = parsed;
          break;
        }
      } catch (_) {}
    }
  }

  const out = {};
  for (const [key, value] of Object.entries(picked)) {
    if (['booking_id', 'bookingId', 'id', 'token'].includes(key)) continue;
    if (Array.isArray(value)) {
      out[key] = value.map((v) => String(v ?? '').trim()).filter(Boolean).join(', ');
      continue;
    }
    if (value && typeof value === 'object') {
      if (Array.isArray(value.values)) {
        out[key] = value.values.map((v) => String(v ?? '').trim()).filter(Boolean).join(', ');
      } else if (value.value !== undefined) {
        out[key] = String(value.value ?? '').trim();
      } else {
        out[key] = JSON.stringify(value);
      }
      continue;
    }
    out[key] = String(value ?? '').trim();
  }

  return out;
}

function cleanBookingId(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s === ':id' || s === ':booking_id') return '';
  return s;
}

app.get('/config.js', (req, res) => {
  res.type('application/javascript').send(
    `window.APP_CONFIG = ${JSON.stringify({
      appName: APP_NAME,
      storagePrefix: STORAGE_PREFIX,
      apiBaseUrl: process.env.API_BASE_URL || '',
      googleFormUrl: DEFAULT_GOOGLE_FORM_URL
    })};`
  );
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'properties.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/webhook-test', (req, res) => {
  const bookingId = req.query.booking_id || '365ffb17-b33e-459c-8ce0-13a196ca861b';
  res.type('text/html').send(`
<!DOCTYPE html>
<html>
<head>
  <title>Webhook Test Form</title>
  <style>
    body { font-family: sans-serif; max-width: 500px; margin: 50px auto; background: #f5f5f5; padding: 20px; }
    .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { color: #333; }
    .form-group { margin-bottom: 15px; }
    label { display: block; margin-bottom: 5px; font-weight: 600; color: #555; }
    input, textarea { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-family: sans-serif; box-sizing: border-box; }
    textarea { resize: vertical; min-height: 80px; }
    button { background: #0d9488; color: white; padding: 12px 20px; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; font-weight: 600; width: 100%; }
    button:hover { background: #0f766e; }
    .success { color: green; margin-top: 10px; padding: 10px; background: #f0fdf4; border-radius: 5px; }
    .error { color: red; margin-top: 10px; padding: 10px; background: #fef2f2; border-radius: 5px; }
    .info { background: #f0f9ff; padding: 10px; border-radius: 5px; margin-bottom: 15px; font-size: 12px; color: #0c4a6e; border: 1px solid #e0f2fe; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🧪 Webhook Test Form</h1>
    <p>Use this form to test if your webhook endpoint is working correctly.</p>
    <div class="info">
      <strong>Booking ID:</strong> <code>${bookingId}</code><br>
      <strong>Webhook URL:</strong> <code>${req.protocol}://${req.get('host')}/api/submit-form</code>
    </div>
    <form id="testForm">
      <div class="form-group">
        <label for="booking_id">Booking ID</label>
        <input type="text" id="booking_id" name="booking_id" value="${bookingId}" required>
      </div>
      <div class="form-group">
        <label for="guest_name">Guest Name</label>
        <input type="text" id="guest_name" name="guest_name" placeholder="e.g. rahil" required>
      </div>
      <div class="form-group">
        <label for="guest_phone">Phone</label>
        <input type="text" id="guest_phone" name="guest_phone" placeholder="e.g. 9770884337">
      </div>
      <div class="form-group">
        <label for="members">Number of Members</label>
        <input type="number" id="members" name="members" placeholder="e.g. 2" min="1">
      </div>
      <div class="form-group">
        <label for="id_of_members">ID of Members</label>
        <textarea id="id_of_members" name="id_of_members" placeholder="e.g. Aadhar uploaded"></textarea>
      </div>
      <button type="submit">Submit Test Response</button>
      <div id="message"></div>
    </form>
  </div>

  <script>
    document.getElementById('testForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const messageEl = document.getElementById('message');
      messageEl.className = '';
      messageEl.textContent = 'Sending...';

      const data = {
        booking_id: document.getElementById('booking_id').value,
        guest_name: document.getElementById('guest_name').value,
        guest_phone: document.getElementById('guest_phone').value,
        members: document.getElementById('members').value,
        id_of_members: document.getElementById('id_of_members').value
      };

      try {
        const res = await fetch('/api/submit-form', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const result = await res.json();
        if (res.ok) {
          messageEl.className = 'success';
          messageEl.textContent = '✅ ' + (result.message || 'Response saved successfully!');
        } else {
          messageEl.className = 'error';
          messageEl.textContent = '❌ ' + (result.message || 'Error saving response');
        }
      } catch (err) {
        messageEl.className = 'error';
        messageEl.textContent = '❌ Network error: ' + err.message;
      }
    });
  </script>
</body>
</html>
  `);
});

app.use(express.static(path.join(__dirname, 'public')));

// ── MongoDB Models ──────────────────────────────────────────
const bookingSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  property_id: { type: String, default: 'property-1', index: true },
  guest_name: { type: String, required: true },
  guest_email: { type: String, default: '' },
  guest_phone: { type: String, default: '' },
  check_in: { type: String, required: true },
  check_out: { type: String, required: true },
  check_in_time: { type: String, default: '14:00' },
  check_out_time: { type: String, default: '11:00' },
  guests: { type: Number, default: 1 },
  nights: { type: Number, default: 1 },
  amount: { type: Number, default: 0 },
  status: { type: String, default: 'pending', index: true },
  color: { type: String, default: '#0d9488' },
  initials: { type: String, default: '??' },
  booking_source: { type: String, default: 'personal' },
  form_link: { type: String, default: '' },
  form_sent: { type: Boolean, default: false },
  form_sent_at: { type: String, default: null },
  host_notes: { type: String, default: '' },
  created_at: { type: String, default: () => new Date().toISOString() },
  updated_at: { type: String, default: () => new Date().toISOString() }
}, { versionKey: false });

const formResponseSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  booking_id: { type: String, required: true, index: true },
  response_data: { type: mongoose.Schema.Types.Mixed, required: true },
  submitted_at: { type: String, default: () => new Date().toISOString() }
}, { versionKey: false });

const hostSettingSchema = new mongoose.Schema({
  property_id: { type: String, default: null, index: true },
  key: { type: String, required: true, index: true },
  value: { type: String, required: true }
}, { versionKey: false });
hostSettingSchema.index({ property_id: 1, key: 1 }, { unique: true });

const Booking = mongoose.model('Booking', bookingSchema);
const FormResponse = mongoose.model('FormResponse', formResponseSchema);
const HostSetting = mongoose.model('HostSetting', hostSettingSchema);

// ── Helpers ─────────────────────────────────────────────────
const SOURCE_COLORS = {
  personal: '#86efac',
  airbnb: '#fca5a5'
};

const normalizeSource = (s) => (String(s || 'personal').toLowerCase() === 'airbnb' ? 'airbnb' : 'personal');
const colorForSource = (s) => SOURCE_COLORS[normalizeSource(s)] || SOURCE_COLORS.personal;
const getInitials = (name) => String(name || '').split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '??';

function toDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr || '00:00'}:00`);
}

function calculateNights(checkIn, checkOut) {
  return Math.max(1, Math.ceil((new Date(checkOut) - new Date(checkIn)) / 86400000));
}

function normalizeBookingDoc(doc) {
  const obj = doc.toObject ? doc.toObject() : doc;
  delete obj._id;
  return obj;
}

async function withResponses(bookingDoc) {
  const booking = normalizeBookingDoc(bookingDoc);
  const responseRows = await FormResponse.find({ booking_id: booking.id }).sort({ submitted_at: -1 }).lean();
  const latestResponse = responseRows[0] || null;
  const responseHistory = responseRows.map((row) => ({
    id: row.id,
    submitted_at: row.submitted_at,
    response_data: row.response_data || {}
  }));
  const booking_source = normalizeSource(booking.booking_source);

  if (responseHistory.length > 0 && booking.status !== 'confirmed' && booking.status !== 'cancelled') {
    await Booking.updateOne(
      { id: booking.id },
      {
        $set: {
          status: 'confirmed',
          form_sent: true,
          form_sent_at: booking.form_sent_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      }
    );
    booking.status = 'confirmed';
    booking.form_sent = true;
    booking.form_sent_at = booking.form_sent_at || new Date().toISOString();
  }

  return {
    ...booking,
    booking_source,
    color: colorForSource(booking_source),
    form_sent: !!booking.form_sent,
    form_responded: responseHistory.length > 0,
    form_response_count: responseHistory.length,
    form_responses: latestResponse ? latestResponse.response_data : {},
    form_responses_history: responseHistory
  };
}

async function syncConfirmedBookingsFromResponses() {
  const confirmedResponseIds = await FormResponse.distinct('booking_id');
  if (!confirmedResponseIds.length) return;

  await Booking.updateMany(
    {
      id: { $in: confirmedResponseIds },
      status: { $nin: ['confirmed', 'cancelled'] }
    },
    {
      $set: {
        status: 'confirmed',
        form_sent: true,
        form_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    }
  );
}

async function hasOverlap({ property_id, check_in, check_out, check_in_time, check_out_time, excludeId }) {
  const existing = await Booking.find({
    status: { $ne: 'cancelled' },
    property_id,
    ...(excludeId ? { id: { $ne: excludeId } } : {})
  }).lean();

  const newStart = toDateTime(check_in, check_in_time);
  const newEnd = toDateTime(check_out, check_out_time);

  for (const b of existing) {
    const oldStart = toDateTime(b.check_in, b.check_in_time || '14:00');
    const oldEnd = toDateTime(b.check_out, b.check_out_time || '11:00');
    if (newStart < oldEnd && oldStart < newEnd) {
      return b;
    }
  }

  return null;
}

async function upsertSetting(key, value, propertyId = null) {
  const filter = { key };
  if (propertyId) filter.property_id = propertyId;
  else filter.property_id = null;
  await HostSetting.findOneAndUpdate(
    filter,
    { property_id: propertyId || null, key, value: String(value) },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function readPropertySettings(propertyId = null) {
  const out = {};
  const globals = await HostSetting.find({ property_id: null }).lean();
  globals.forEach((row) => {
    out[row.key] = row.value;
  });

  if (propertyId) {
    const scoped = await HostSetting.find({ property_id: propertyId }).lean();
    scoped.forEach((row) => {
      out[row.key] = row.value;
    });
  }

  return out;
}

async function migrateHostSettingIndexes() {
  try {
    const indexes = await HostSetting.collection.indexes();
    const legacyKeyIndex = indexes.find((idx) => idx.name === 'key_1' && idx.unique);
    if (legacyKeyIndex) {
      await HostSetting.collection.dropIndex('key_1');
      console.log('🛠️ Dropped legacy unique index on hostsettings.key');
    }
  } catch (error) {
    if (!String(error?.message || error).includes('index not found')) {
      console.warn('Index migration warning:', error.message || error);
    }
  }

  try {
    await HostSetting.syncIndexes();
  } catch (error) {
    console.warn('Index sync warning:', error.message || error);
  }
}

async function seedDefaults() {
  const count = await Booking.countDocuments();
  if (count === 0) {
    console.log('🌱 Seeding demo data...');

    const now = new Date().getFullYear();
    const nm = new Date().getMonth();
    const pad = (n) => String(n).padStart(2, '0');
    const date = (d) => `${now}-${pad(nm + 1)}-${pad(d)}`;

    const seeds = [
      {
        id: uuidv4(),
        guest_name: 'Sarah Mehta',
        guest_email: 'sarah.m@email.com',
        guest_phone: '+91 98765 43210',
        check_in: date(6),
        check_out: date(8),
        check_in_time: '14:00',
        check_out_time: '11:00',
        guests: 2,
        nights: 3,
        amount: 12500,
        status: 'confirmed',
        color: '#0d9488',
        initials: 'SM',
        booking_source: 'personal',
        form_link: 'https://forms.gle/example',
        form_sent: true,
        form_sent_at: `${date(1)}T10:00:00`,
        host_notes: 'Repeat guest. Very clean. ⭐⭐⭐⭐⭐',
        property_id: 'property-1'
      },
      {
        id: uuidv4(),
        guest_name: 'Priya Kapoor',
        guest_email: 'priya.k@email.com',
        guest_phone: '+91 91234 56789',
        check_in: date(14),
        check_out: date(16),
        check_in_time: '15:00',
        check_out_time: '10:00',
        guests: 3,
        nights: 3,
        amount: 12300,
        status: 'confirmed',
        color: '#6366f1',
        initials: 'PK',
        booking_source: 'personal',
        form_link: 'https://forms.gle/example2',
        form_sent: true,
        form_sent_at: `${date(5)}T14:00:00`,
        host_notes: 'First time guest. Verified ID.',
        property_id: 'property-1'
      }
    ];

    await Booking.insertMany(seeds);

    await FormResponse.create({
      id: uuidv4(),
      booking_id: seeds[0].id,
      response_data: {
        'Purpose of stay': 'Leisure trip with family',
        'Estimated arrival time': '3:00 PM',
        'Special requests': 'Baby cot needed, quiet room preferred'
      }
    });

    await FormResponse.create({
      id: uuidv4(),
      booking_id: seeds[1].id,
      response_data: {
        'Purpose of stay': 'Business trip',
        'Estimated arrival time': '6:00 PM',
        'Special requests': 'Early check-in if possible'
      }
    });

    console.log('✅ Demo data seeded!');
  }

  await upsertSetting('property_name', DEFAULT_PROPERTY_NAME);
  await upsertSetting('price_per_night', '4100');
  await upsertSetting('google_form_link', DEFAULT_GOOGLE_FORM_URL);
  await upsertSetting('form_prefill_field', 'entry.1457480287');
  await upsertSetting('gmail_user', 'earthyhomestay@gmail.com');
  await upsertSetting('gmail_app_password', '');

  // Seed property-2 scoped defaults (example)
  await upsertSetting('property_name', 'Sea View Studio', 'property-2');
  await upsertSetting('price_per_night', '4100', 'property-2');
  await upsertSetting('google_form_link', DEFAULT_GOOGLE_FORM_URL, 'property-2');
  await upsertSetting('form_prefill_field', 'entry.1457480287', 'property-2');
  await upsertSetting('gmail_user', '', 'property-2');
  await upsertSetting('gmail_app_password', '', 'property-2');
}

// ── ROUTES ──────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = USERS[username];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = generateToken();
  VALID_TOKENS.add(token);

  res.json({
    success: true,
    token,
    username,
    name: user.name
  });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) VALID_TOKENS.delete(token);
  res.json({ success: true });
});

app.get('/api/auth/verify', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !VALID_TOKENS.has(token)) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  res.json({ success: true });
});

app.get('/api/bookings', requireAuth, async (req, res) => {
  try {
    const { month, year, property_id } = req.query;
    const pid = String(property_id || 'property-1');

    let rows = await Booking.find({
      status: { $ne: 'cancelled' },
      property_id: pid
    }).lean();

    if (month !== undefined && year !== undefined) {
      const m = String(parseInt(month, 10) + 1).padStart(2, '0');
      const y = String(year);
      rows = rows.filter((r) => String(r.check_in || '').slice(5, 7) === m && String(r.check_in || '').slice(0, 4) === y);
    }

    rows.sort((a, b) => `${a.check_in} ${a.check_in_time}`.localeCompare(`${b.check_in} ${b.check_in_time}`));

    const data = await Promise.all(rows.map((r) => withResponses(r)));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/bookings/:id', requireAuth, async (req, res) => {
  try {
    const booking = await Booking.findOne({ id: req.params.id });
    if (!booking) return res.status(404).json({ success: false, message: 'Not found' });

    res.json({ success: true, data: await withResponses(booking) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/bookings', requireAuth, async (req, res) => {
  try {
    const {
      guest_name, guest_email, guest_phone,
      check_in, check_out, check_in_time, check_out_time,
      guests, amount, booking_source, property_id
    } = req.body || {};

    const normalizedPropertyId = String(property_id || 'property-1').trim() || 'property-1';
    const normalizedCheckInTime = String(check_in_time || '14:00').trim() || '14:00';
    const normalizedCheckOutTime = String(check_out_time || '11:00').trim() || '11:00';
    const parsedGuests = guests === undefined || guests === null || String(guests).trim() === '' ? 1 : parseInt(guests, 10);

    const requiredFields = { guest_name, guest_phone, check_in, check_out, amount };
    const missingFields = Object.entries(requiredFields)
      .filter(([, v]) => v === undefined || v === null || String(v).trim() === '')
      .map(([k]) => k);

    if (missingFields.length) {
      return res.status(400).json({ success: false, message: `Missing required fields: ${missingFields.join(', ')}` });
    }

    const parsedAmount = parseInt(amount, 10);
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount is required and must be greater than 0' });
    }

    if (Number.isNaN(parsedGuests) || parsedGuests <= 0) {
      return res.status(400).json({ success: false, message: 'Guests is required and must be greater than 0' });
    }

    const checkInDate = new Date(check_in);
    const checkOutDate = new Date(check_out);
    if (checkOutDate < checkInDate) {
      return res.status(400).json({ success: false, message: 'Check-out must be on or after check-in date' });
    }

    const overlap = await hasOverlap({
      property_id: normalizedPropertyId,
      check_in,
      check_out,
      check_in_time: normalizedCheckInTime,
      check_out_time: normalizedCheckOutTime
    });

    if (overlap) {
      const overlapCheckIn = `${overlap.check_in} ${overlap.check_in_time}`;
      const overlapCheckOut = `${overlap.check_out} ${overlap.check_out_time}`;
      return res.status(409).json({
        success: false,
        message: `Booking conflicts with ${overlap.guest_name} (${overlapCheckIn} to ${overlapCheckOut})`
      });
    }

    const normalizedSource = normalizeSource(booking_source);
    const booking = {
      id: uuidv4(),
      guest_name,
      guest_email: guest_email || '',
      property_id: normalizedPropertyId,
      guest_phone,
      check_in,
      check_out,
      check_in_time: normalizedCheckInTime,
      check_out_time: normalizedCheckOutTime,
      guests: parsedGuests,
      nights: calculateNights(check_in, check_out),
      amount: parsedAmount,
      status: 'pending',
      color: colorForSource(normalizedSource),
      initials: getInitials(guest_name),
      booking_source: normalizedSource,
      form_link: '',
      form_sent: false,
      form_sent_at: null,
      host_notes: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await Booking.create(booking);
    res.status(201).json({ success: true, data: { ...booking, form_responded: false, form_responses: {} } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.patch('/api/bookings/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await Booking.findOne({ id }).lean();
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });

    const allowed = [
      'status', 'host_notes', 'form_link',
      'guest_name', 'guest_email', 'guest_phone',
      'check_in', 'check_out', 'check_in_time', 'check_out_time',
      'guests', 'amount', 'booking_source'
    ];

    const updates = {};
    allowed.forEach((f) => {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    });

    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }

    const merged = { ...existing, ...updates };

    const requiredFields = {
      guest_name: merged.guest_name,
      guest_phone: merged.guest_phone,
      check_in: merged.check_in,
      check_out: merged.check_out,
      amount: merged.amount
    };

    const missingFields = Object.entries(requiredFields)
      .filter(([, v]) => v === undefined || v === null || String(v).trim() === '')
      .map(([k]) => k);

    if (missingFields.length) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    const parsedAmount = parseInt(merged.amount, 10);
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount is required and must be greater than 0' });
    }

    const normalizedCheckInTime = String(merged.check_in_time || '14:00').trim() || '14:00';
    const normalizedCheckOutTime = String(merged.check_out_time || '11:00').trim() || '11:00';
    const parsedGuests = merged.guests === undefined || merged.guests === null || String(merged.guests).trim() === '' ? 1 : parseInt(merged.guests, 10);

    if (Number.isNaN(parsedGuests) || parsedGuests <= 0) {
      return res.status(400).json({ success: false, message: 'Guests is required and must be greater than 0' });
    }

    const checkInDateTime = toDateTime(merged.check_in, normalizedCheckInTime);
    const checkOutDateTime = toDateTime(merged.check_out, normalizedCheckOutTime);

    if (checkOutDateTime <= checkInDateTime) {
      return res.status(400).json({ success: false, message: 'Check-out must be after check-in' });
    }

    const overlap = await hasOverlap({
      property_id: merged.property_id || 'property-1',
      check_in: merged.check_in,
      check_out: merged.check_out,
      check_in_time: normalizedCheckInTime,
      check_out_time: normalizedCheckOutTime,
      excludeId: id
    });

    if (overlap) {
      const overlapCheckIn = `${overlap.check_in} ${overlap.check_in_time}`;
      const overlapCheckOut = `${overlap.check_out} ${overlap.check_out_time}`;
      return res.status(409).json({
        success: false,
        message: `Booking conflicts with ${overlap.guest_name} (${overlapCheckIn} to ${overlapCheckOut})`
      });
    }

    updates.check_in_time = normalizedCheckInTime;
    updates.check_out_time = normalizedCheckOutTime;
    updates.amount = parsedAmount;
    updates.guests = parsedGuests;
    updates.nights = calculateNights(merged.check_in, merged.check_out);

    if (updates.booking_source !== undefined) {
      updates.booking_source = normalizeSource(updates.booking_source);
      updates.color = colorForSource(updates.booking_source);
    }

    if (updates.guest_name !== undefined) {
      updates.initials = getInitials(String(merged.guest_name));
    }

    updates.updated_at = new Date().toISOString();

    await Booking.updateOne({ id }, { $set: updates });
    const updated = await Booking.findOne({ id });

    res.json({ success: true, data: await withResponses(updated) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/bookings/:id', requireAuth, async (req, res) => {
  try {
    await Booking.updateOne(
      { id: req.params.id },
      { $set: { status: 'cancelled', updated_at: new Date().toISOString() } }
    );

    res.json({ success: true, message: 'Booking cancelled' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/bookings/:id/send-form', requireAuth, async (req, res) => {
  try {
    const { form_link } = req.body;

    const b = await Booking.findOne({ id: req.params.id }).lean();
    if (!b) return res.status(404).json({ success: false, message: 'Booking not found' });

    const propertyId = b.property_id || 'property-1';
    const settings = await readPropertySettings(propertyId);
    const gmailUser = String(settings.gmail_user || process.env.GMAIL_USER || '').trim();
    const gmailPass = String(settings.gmail_app_password || process.env.GMAIL_APP_PASSWORD || '').trim();
    
    // Generate dynamic form link with booking ID
    const finalFormLink = form_link || generateFormLink(b.id);

    let emailSent = false;
    let emailError = null;

    if (gmailUser && gmailPass && b.guest_email) {
      try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user: gmailUser, pass: gmailPass }
        });

        await transporter.sendMail({
          from: gmailUser,
          to: b.guest_email,
          subject: `Guest form for ${settings.property_name || 'your stay'}`,
          text: [
            `Hi ${b.guest_name},`,
            '',
            'Please fill your guest form using the link below:',
            finalFormLink,
            '',
            'Thanks.'
          ].join('\n'),
          html: `<p>Hi ${b.guest_name},</p><p>Please fill your guest form using the link below:</p><p><a href="${finalFormLink}">${finalFormLink}</a></p><p>Thanks.</p>`
        });

        emailSent = true;
      } catch (err) {
        emailError = err?.message || String(err);
        console.warn('Failed to send guest form email:', emailError);
      }
    }

    const now = new Date().toISOString();
    await Booking.updateOne(
      { id: req.params.id },
      { $set: { form_link: finalFormLink, form_sent: true, form_sent_at: now, updated_at: now } }
    );

    res.json({
      success: true,
      message: emailSent ? 'Form link sent' : 'Form link saved',
      data: {
        email_sent: emailSent,
        email_error: emailError,
        property_id: propertyId,
        form_link: finalFormLink
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/bookings/:id/send-whatsapp', requireAuth, async (req, res) => {
  try {
    const { form_link } = req.body;
    if (!form_link) return res.status(400).json({ success: false, message: 'form_link required' });

    const b = await Booking.findOne({ id: req.params.id }).lean();
    if (!b) return res.status(404).json({ success: false, message: 'Booking not found' });

    const rawPhone = String(b.guest_phone || '').trim();
    if (!rawPhone) {
      return res.status(400).json({ success: false, message: 'Guest phone number not found' });
    }

    let phone = rawPhone.replace(/\D/g, '');
    if (phone.length === 10) phone = `91${phone}`;
    if (phone.length < 11) {
      return res.status(400).json({ success: false, message: 'Invalid guest phone number for WhatsApp' });
    }

    const setting = await HostSetting.findOne({ key: 'property_name' }).lean();
    const propertyName = setting?.value || 'StayBook';
    const message = `Hi ${b.guest_name}, please fill your guest form for ${propertyName}: ${form_link}`;
    const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

    const now = new Date().toISOString();
    await Booking.updateOne(
      { id: req.params.id },
      { $set: { form_link, form_sent: true, form_sent_at: now, updated_at: now } }
    );

    res.json({
      success: true,
      message: 'WhatsApp link ready',
      data: { whatsapp_url: whatsappUrl }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

async function handleSubmitForm(req, res) {
  try {
    let booking_id =
      cleanBookingId(req.params.id) ||
      cleanBookingId(req.params.booking_id) ||
      cleanBookingId(req.body?.booking_id) ||
      cleanBookingId(req.body?.bookingId) ||
      cleanBookingId(req.body?.id) ||
      cleanBookingId(req.query?.booking_id) ||
      cleanBookingId(req.query?.bookingId) ||
      cleanBookingId(req.query?.id);

    // If booking_id wasn't provided directly, try to infer it from payload values
    // (e.g. Google Forms entry.* field containing the prefilled booking ID).
    if (!booking_id) {
      const dataProbe = normalizeWebhookPayload(req.body || {});
      const candidates = Object.values(dataProbe)
        .map((v) => cleanBookingId(v))
        .filter(Boolean)
        .slice(0, 50);

      for (const candidate of candidates) {
        const exists = await Booking.exists({ id: candidate });
        if (exists) {
          booking_id = candidate;
          break;
        }
      }
    }

    if (!booking_id) {
      pushWebhookLog({
        type: 'submit-form',
        status: 'missing_booking_id',
        path: req.originalUrl,
        method: req.method,
        bodyKeys: Object.keys(req.body || {}),
        query: safeLogPayload(req.query || {})
      });
      return res.status(400).json({ success: false, message: 'booking_id is required' });
    }

    const booking = await Booking.findOne({ id: booking_id }).lean();
    if (!booking) {
      pushWebhookLog({
        type: 'submit-form',
        status: 'booking_not_found',
        booking_id,
        path: req.originalUrl,
        method: req.method
      });
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (!booking.form_sent_at) {
      pushWebhookLog({
        type: 'submit-form',
        status: 'form_not_sent',
        booking_id,
        path: req.originalUrl,
        method: req.method
      });
      return res.status(400).json({ success: false, message: 'Form link has not been sent for this booking yet' });
    }

    // Accept responses as soon as the form link has been sent.
    // (Do not gate by check-in/check-out dates.)

    const data = normalizeWebhookPayload(req.body || {});
    console.log('Incoming webhook data for booking', booking_id, data);
    pushWebhookLog({
      type: 'submit-form',
      status: 'received',
      booking_id,
      path: req.originalUrl,
      method: req.method,
      keys: Object.keys(data || {}),
      payload: safeLogPayload(data)
    });

    await FormResponse.create({
      id: uuidv4(),
      booking_id,
      response_data: data,
      submitted_at: new Date().toISOString()
    });

    const submissionCount = await FormResponse.countDocuments({ booking_id });

    await Booking.updateOne(
      { id: booking_id },
      { $set: { status: 'confirmed', updated_at: new Date().toISOString() } }
    );

    console.log(`📋 Form response received for booking ${booking_id}`);
    pushWebhookLog({
      type: 'submit-form',
      status: 'saved',
      booking_id,
      submissionCount
    });
    res.json({ success: true, message: 'Response saved', data: { submission_count: submissionCount } });
  } catch (error) {
    pushWebhookLog({
      type: 'submit-form',
      status: 'error',
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({ success: false, message: error.message });
  }
}

app.get('/api/webhook-logs', requireAuth, (req, res) => {
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '25', 10) || 25));
  res.json({ success: true, data: webhookLogs.slice(0, limit) });
});

app.post('/api/submit-form/:id', handleSubmitForm);
app.post('/api/submit-form/:booking_id', handleSubmitForm);
app.post('/api/submit-form', handleSubmitForm);

app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const { month, year, property_id } = req.query;
    const pid = String(property_id || 'property-1');
    const mm = String(parseInt(month ?? new Date().getMonth(), 10) + 1).padStart(2, '0');
    const yy = String(year ?? new Date().getFullYear());

    const rows = await Booking.find({
      status: { $ne: 'cancelled' },
      property_id: pid
    }).lean();

    const scoped = rows.filter((r) => String(r.check_in || '').slice(5, 7) === mm && String(r.check_in || '').slice(0, 4) === yy);

    const total_bookings = scoped.length;
    const total_nights = scoped.reduce((acc, b) => acc + (Number(b.nights) || 0), 0);
    const total_revenue = scoped.reduce((acc, b) => acc + (Number(b.amount) || 0), 0);
    const confirmed = scoped.filter((b) => b.status === 'confirmed').length;
    const pending = scoped.filter((b) => b.status === 'pending').length;

    const dim = new Date(parseInt(yy, 10), parseInt(mm, 10), 0).getDate();

    res.json({
      success: true,
      data: {
        total_bookings,
        total_nights,
        total_revenue,
        confirmed,
        pending,
        occupancy: total_nights ? Math.min(100, Math.round((total_nights / dim) * 100)) : 0
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/settings', requireAuth, async (req, res) => {
  try {
    const propertyId = req.query.property_id || null;
    const globals = await HostSetting.find({ property_id: null }).lean();
    const out = {};
    globals.forEach((r) => { out[r.key] = r.value; });
    if (propertyId) {
      const props = await HostSetting.find({ property_id: propertyId }).lean();
      props.forEach((r) => { out[r.key] = r.value; });
    }
    res.json({ success: true, data: out });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.patch('/api/settings', requireAuth, async (req, res) => {
  try {
    const propertyId = req.query.property_id || null;
    const entries = Object.entries(req.body || {});
    await Promise.all(entries.map(([k, v]) => upsertSetting(k, String(v), propertyId)));
    res.json({ success: true, message: 'Settings updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('*', (req, res) => {
  res.redirect('/');
});

// ── Start ───────────────────────────────────────────────────
async function start() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000
    });

    console.log(`🗄️ Connected to MongoDB: ${MONGODB_URI}`);

    await migrateHostSettingIndexes();

    await syncConfirmedBookingsFromResponses();

    await seedDefaults();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🏠 StayBook running on port ${PORT}`);
      console.log(`\n📡 API Endpoints:`);
      console.log(`   GET    /api/bookings`);
      console.log(`   POST   /api/bookings`);
      console.log(`   PATCH  /api/bookings/:id`);
      console.log(`   DELETE /api/bookings/:id`);
      console.log(`   POST   /api/bookings/:id/send-form`);
      console.log(`   POST   /api/bookings/:id/send-whatsapp`);
      console.log(`   POST   /api/submit-form/:booking_id`);
      console.log(`   GET    /api/stats`);
      console.log(`   GET    /api/settings\n`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

start();
