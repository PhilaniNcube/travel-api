# Payments API Documentation

## Overview

The Payments API provides endpoints for managing payment transactions for bookings. It supports multiple payment providers (Stripe, PayPal, manual) and payment methods.

---

## Endpoints

### 1. Create Payment

**POST** `/api/payments`

Creates a new payment for a booking. Supports multiple payment providers including Stripe for online payments and manual processing for cash/bank transfers.

#### Authentication

- ✅ **Required**: User must be authenticated
- ✅ **Authorization**: User must own the booking

#### Request Body

```json
{
  "bookingId": "string",           // Required: ID of the booking to pay for
  "amount": number,                // Optional: Payment amount (defaults to booking total)
  "currency": "string",            // Optional: ISO 4217 currency code (default: "USD")
  "paymentMethod": "enum",         // Optional: Payment method (default: "credit_card")
  "paymentProvider": "enum",       // Optional: Payment provider (default: "stripe")
  "metadata": {                    // Optional: Additional payment metadata
    "key": "value"
  }
}
```

#### Payment Methods

- `credit_card`
- `debit_card`
- `paypal`
- `bank_transfer`
- `cash`
- `other`

#### Payment Providers

- `stripe` - Online credit/debit card payments (default)
- `paypal` - PayPal payments
- `square` - Square payments
- `manual` - Manual/offline payments (cash, bank transfer)

#### Response (201 Created)

```json
{
  "success": true,
  "data": {
    "payment": {
      "id": "string",
      "bookingId": "string",
      "amount": number,
      "currency": "string",
      "paymentMethod": "string",
      "paymentStatus": "pending",
      "paymentProvider": "string",
      "paymentIntentId": "string",  // Stripe PaymentIntent ID (for Stripe payments)
      "createdAt": "ISO 8601 date"
    },
    "clientSecret": "string",       // Stripe client secret (for frontend integration)
    "providerData": {               // Provider-specific data
      "id": "string",
      "status": "string"
    }
  },
  "message": "Payment intent created. Use the client secret to complete payment on the frontend."
}
```

#### Error Responses

**401 Unauthorized**
```json
{
  "success": false,
  "error": "User not found in session"
}
```

**403 Forbidden**
```json
{
  "success": false,
  "error": "Forbidden - You do not have permission to create a payment for this booking"
}
```

**404 Not Found**
```json
{
  "success": false,
  "error": "Booking not found"
}
```

**400 Bad Request**
```json
{
  "success": false,
  "error": "Cannot create payment for a cancelled booking"
}
```

```json
{
  "success": false,
  "error": "Payment amount must be greater than zero"
}
```

```json
{
  "success": false,
  "error": "Payment amount ($1500) cannot exceed booking total ($1000)"
}
```

**500 Internal Server Error**
```json
{
  "success": false,
  "error": "Failed to create payment intent with Stripe",
  "details": "Stripe error message"
}
```

---

### 2. Get Payment by ID

**GET** `/api/payments/:id`

Retrieves detailed information about a specific payment.

#### Authentication

- ✅ **Required**: User must be authenticated
- ✅ **Authorization**: User must own the payment (via booking) OR be an admin

#### Response (200 OK)

```json
{
  "success": true,
  "data": {
    "id": "string",
    "bookingId": "string",
    "amount": "string",
    "currency": "string",
    "paymentMethod": "string",
    "paymentStatus": "string",
    "transactionId": "string",
    "paymentProvider": "string",
    "paymentIntentId": "string",
    "metadata": {},
    "createdAt": "ISO 8601 date",
    "updatedAt": "ISO 8601 date",
    "booking": {
      "id": "string",
      "status": "string",
      "totalPrice": "string",
      "startDate": "ISO 8601 date",
      "endDate": "ISO 8601 date"
    }
  }
}
```

---

## Implementation Details

### Stripe Integration

The API integrates with Stripe for online payment processing:

1. **Payment Intent Creation**: When a payment is created with `paymentProvider: "stripe"`, a Stripe PaymentIntent is created automatically.

2. **Client Secret**: The response includes a `clientSecret` that should be used on the frontend with Stripe Elements or Stripe SDK to complete the payment.

3. **Webhook Handling**: After the payment is completed on the frontend, Stripe will send a webhook to update the payment status (to be implemented in webhook handler).

### Frontend Integration Example

```javascript
// 1. Create payment on backend
const response = await fetch('/api/payments', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    bookingId: 'booking-123',
    currency: 'USD',
    paymentMethod: 'credit_card',
    paymentProvider: 'stripe'
  })
});

const { data } = await response.json();
const { clientSecret } = data;

// 2. Use Stripe.js to complete payment on frontend
const stripe = Stripe('pk_test_...');
const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
  payment_method: {
    card: cardElement,
    billing_details: {
      name: 'Customer Name'
    }
  }
});

if (error) {
  // Handle error
} else if (paymentIntent.status === 'succeeded') {
  // Payment successful!
}
```

### Payment Flow

1. **User initiates payment** → Frontend calls `POST /api/payments`
2. **Backend validates** → Checks booking ownership, status, and amount
3. **Payment Intent created** → Creates Stripe PaymentIntent (for Stripe payments)
4. **Client secret returned** → Frontend receives client secret
5. **User completes payment** → Frontend uses Stripe.js to collect card details and confirm payment
6. **Webhook received** → Stripe sends webhook to backend (webhook handler updates payment status)
7. **Booking updated** → Booking status updated based on payment completion

### Security Considerations

1. **User Authentication**: All endpoints require authentication
2. **Authorization**: Users can only create payments for their own bookings
3. **Amount Validation**: Payment amount cannot exceed booking total
4. **Status Checks**: Cannot create payments for cancelled bookings
5. **Webhook Verification**: Webhook signatures should be verified (to be implemented)

### Environment Variables

Add these to your `.env` file:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## Testing

Use the provided `.http` file to test the endpoints:

```http
### Create Payment (Stripe)
POST http://localhost:3000/api/payments
Content-Type: application/json

{
  "bookingId": "your-booking-id",
  "currency": "USD",
  "paymentMethod": "credit_card",
  "paymentProvider": "stripe"
}

### Create Payment with Custom Amount (Deposit)
POST http://localhost:3000/api/payments
Content-Type: application/json

{
  "bookingId": "your-booking-id",
  "amount": 500.00,
  "currency": "USD",
  "paymentMethod": "credit_card",
  "paymentProvider": "stripe",
  "metadata": {
    "paymentType": "deposit"
  }
}
```

---

## Next Steps

To complete the payment system, implement:

1. ✅ **Create Payment** - `POST /api/payments` (Completed)
2. ⏳ **Update Payment Status** - `PATCH /api/payments/:id` (Admin only)
3. ⏳ **Process Refund** - `POST /api/payments/:id/refund`
4. ⏳ **Payment Webhook Handler** - `POST /api/webhooks/payment`
5. ⏳ **List Booking Payments** - `GET /api/bookings/:id/payments`

---

## Support

For Stripe documentation, visit: https://stripe.com/docs/api
