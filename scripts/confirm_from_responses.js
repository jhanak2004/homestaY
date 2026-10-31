require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set in environment');
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('Connected to MongoDB');

  const bookingSchema = new mongoose.Schema({ id: String, status: String }, { strict: false, collection: 'bookings' });
  const formResponseSchema = new mongoose.Schema({ booking_id: String }, { strict: false, collection: 'formresponses' });

  const Booking = mongoose.model('BookingConfirmScript', bookingSchema);
  const FormResponse = mongoose.model('FormResponseConfirmScript', formResponseSchema);

  const bookingIds = await FormResponse.distinct('booking_id');
  if (!bookingIds || bookingIds.length === 0) {
    console.log('No form responses found. Nothing to confirm.');
    process.exit(0);
  }

  const result = await Booking.updateMany(
    { id: { $in: bookingIds }, status: { $ne: 'confirmed' } },
    { $set: { status: 'confirmed', updated_at: new Date().toISOString() } }
  );

  console.log(`Updated ${result.modifiedCount || result.nModified || 0} bookings to confirmed`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
