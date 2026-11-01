const API_URL =
  "https://homestay-2zyf.onrender.com/api/submit-form";

function onFormSubmit(e) {
  try {
    if (!e || !e.response) {
      throw new Error("Missing Google Form submission event.");
    }

    const formData = {};
    let bookingId = "";

    // Read every submitted Google Form answer
    const itemResponses = e.response.getItemResponses();

    itemResponses.forEach(itemResponse => {
      const question = itemResponse.getItem().getTitle();
      const answer = itemResponse.getResponse();

      formData[question] = answer;

      if (question.trim().toLowerCase() === "booking id") {
        bookingId = String(answer).trim();
      }
    });

    if (!bookingId) {
      throw new Error("Booking ID is missing.");
    }

    const payload = {
      ...formData,
      booking_id: bookingId
    };

    // Send response to Render and MongoDB
    const response = UrlFetchApp.fetch(
      API_URL + "/" + encodeURIComponent(bookingId),
      {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      }
    );

    const status = response.getResponseCode();
    const result = response.getContentText();

    Logger.log("Booking ID: " + bookingId);
    Logger.log("HTTP Status: " + status);
    Logger.log("Backend Response: " + result);

    if (status < 200 || status >= 300) {
      throw new Error("Backend error: " + result);
    }

  } catch (error) {
    Logger.log("Submission error: " + error.message);
    throw error;
  }
}
