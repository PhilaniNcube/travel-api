# Payment Webhook Implementation

## Overview

The payment webhook handler processes real-time events from payment providers (currently Stripe) to automatically update payment and booking statuses in the database.

## Endpoint

**POST** `/api/webhooks/payment`

- **Authentication**: None required (uses webhook signature verification)
- **Content-Type**: `application/json`
- **Headers**: 
  - `Stripe-Signature`: Required for Stripe webhook verification

## Supported Events

### 1. Payment Intent Succeeded (`payment_intent.succeeded`)

**Triggered when**: A payment is successfully completed

**Actions**:
- Updates payment status to `completed`
- Records transaction ID from Stripe charge
- Calculates total paid for booking
- If booking is fully paid, updates booking status to `confirmed`

**Example**:
```json
{
  "type": "payment_intent.succeeded",
  "data": {
    "object": {
      "id": "pi_123...",
      "amount": 10000,
      "currency": "usd",
      "status": "succeeded",
      "latest_charge": "ch_123..."
    }
  }
}
```

### 2. Payment Intent Failed (`payment_intent.payment_failed`)

**Triggered when**: A payment attempt fails

**Actions**:
- Updates payment status to `failed`
- Logs failure details
- Can trigger notification to user (future enhancement)

**Example**:
```json
{
  "type": "payment_intent.payment_failed",
  "data": {
    "object": {
      "id": "pi_123...",
      "status": "requires_payment_method",
      "last_payment_error": {
        "message": "Card declined"
      }
    }
  }
}
```

### 3. Payment Intent Canceled (`payment_intent.canceled`)

**Triggered when**: A payment is canceled before completion

**Actions**:
- Updates payment status to `failed`
- Logs cancellation

### 4. Charge Refunded (`charge.refunded`)

**Triggered when**: A payment is refunded (full or partial)

**Actions**:
- Updates payment status to `refunded` or `partially_refunded`
- If all payments for booking are refunded, marks booking as `cancelled`

**Example**:
```json
{
  "type": "charge.refunded",
  "data": {
    "object": {
      "id": "ch_123...",
      "amount": 10000,
      "amount_refunded": 10000,
      "refunded": true
    }
  }
}
```

## Security

### Webhook Signature Verification

All webhook requests are verified using Stripe's signature verification:

1. Stripe includes a `Stripe-Signature` header with each webhook
2. The signature is computed using the raw request body and your webhook secret
3. Our handler uses `stripe.webhooks.constructEvent()` to verify authenticity
4. Invalid signatures are rejected with a 400 error

**Configuration**:
```env
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

### Why Signature Verification Matters

- Prevents unauthorized parties from sending fake webhook events
- Ensures events actually came from Stripe
- Protects against replay attacks

## Setup Guide

### Local Development with Stripe CLI

1. **Install Stripe CLI**
   ```bash
   # macOS
   brew install stripe/stripe-cli/stripe
   
   # Windows (via Scoop)
   scoop bucket add stripe https://github.com/stripe/scoop-stripe-cli.git
   scoop install stripe
   
   # Or download from: https://stripe.com/docs/stripe-cli
   ```

2. **Login to Stripe**
   ```bash
   stripe login
   ```

3. **Forward Webhooks to Local Server**
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/payment
   ```
   
   This will display your webhook signing secret:
   ```
   > Ready! Your webhook signing secret is whsec_xxxxx
   ```

4. **Update Environment Variables**
   ```env
   STRIPE_WEBHOOK_SECRET=whsec_xxxxx
   ```

5. **Trigger Test Events**
   ```bash
   # Test successful payment
   stripe trigger payment_intent.succeeded
   
   # Test failed payment
   stripe trigger payment_intent.payment_failed
   
   # Test refund
   stripe trigger charge.refunded
   ```

### Production Setup

1. **Create Webhook Endpoint in Stripe Dashboard**
   - Go to: https://dashboard.stripe.com/webhooks
   - Click "Add endpoint"
   - URL: `https://your-api-domain.com/api/webhooks/payment`
   - Events to listen to:
     - `payment_intent.succeeded`
     - `payment_intent.payment_failed`
     - `payment_intent.canceled`
     - `charge.refunded`

2. **Get Webhook Secret**
   - After creating the endpoint, Stripe provides a webhook signing secret
   - Add it to your production environment variables

3. **Test the Endpoint**
   - Use Stripe Dashboard's "Send test webhook" feature
   - Monitor your server logs for successful processing

## Business Logic

### Payment Success Flow

```
1. Webhook received: payment_intent.succeeded
2. Verify signature ✓
3. Find payment by paymentIntentId
4. Update payment status → completed
5. Record transaction ID
6. Calculate total paid for booking
7. If total paid ≥ booking total:
   → Update booking status to "confirmed"
```

### Refund Flow

```
1. Webhook received: charge.refunded
2. Verify signature ✓
3. Find payment by transactionId (charge ID)
4. Calculate refund amount
5. If full refund:
   → Update payment status to "refunded"
6. If partial refund:
   → Update payment status to "partially_refunded"
7. If all booking payments refunded:
   → Update booking status to "cancelled"
```

## Error Handling

### Signature Verification Failed
- **Status**: 400 Bad Request
- **Response**: `{ "success": false, "error": "Invalid signature" }`
- **Cause**: Invalid or missing Stripe-Signature header

### Webhook Secret Not Configured
- **Status**: 500 Internal Server Error
- **Response**: `{ "success": false, "error": "Webhook secret not configured" }`
- **Fix**: Add `STRIPE_WEBHOOK_SECRET` to environment variables

### Payment Not Found
- **Log**: "Payment not found for PaymentIntent: pi_xxx"
- **Response**: 200 (acknowledge receipt to prevent retries)
- **Cause**: Payment record doesn't exist or PaymentIntent ID mismatch

### Processing Error
- **Status**: 500 Internal Server Error
- **Response**: `{ "success": false, "error": "Internal server error..." }`
- **Result**: Stripe will retry webhook delivery

## Webhook Retry Logic

Stripe automatically retries failed webhooks:
- Initial attempt: Immediate
- Retry 1: ~5 minutes
- Retry 2: ~30 minutes
- Retry 3: ~2 hours
- Final retries: Up to 3 days

**Best Practices**:
- Always return 200 status for successfully processed events
- Return 500 only for temporary failures that should be retried
- Implement idempotency to handle duplicate events safely

## Monitoring and Logging

### Console Logs

The handler logs important events:
```
✓ Received webhook event: payment_intent.succeeded
✓ Processing successful payment: pi_123...
✓ Payment abc123 marked as completed
✓ Booking xyz789 confirmed - fully paid
```

### Production Monitoring

Recommended monitoring:
1. Track webhook success/failure rates
2. Alert on signature verification failures
3. Monitor payment processing latency
4. Log unhandled event types

## Testing

### Manual Testing with cURL

```bash
# Note: This requires a valid Stripe signature
# Use Stripe CLI for proper testing

curl -X POST http://localhost:3000/api/webhooks/payment \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: your_signature" \
  -d '{
    "type": "payment_intent.succeeded",
    "data": {
      "object": {
        "id": "pi_test_123",
        "status": "succeeded",
        "latest_charge": "ch_test_123"
      }
    }
  }'
```

### Testing Workflow

1. Create a booking via API
2. Create a payment for the booking
3. Use Stripe CLI to trigger webhook events
4. Verify payment and booking status updates in database
5. Check console logs for processing confirmation

## Future Enhancements

- [ ] Add support for PayPal webhooks
- [ ] Implement email notifications on payment events
- [ ] Add webhook event logging to database
- [ ] Implement retry logic for failed database updates
- [ ] Add support for partial payment scenarios
- [ ] Create admin dashboard for webhook monitoring
- [ ] Add webhook event replay functionality
- [ ] Implement webhook event deduplication

## Related Documentation

- [Payments API](./PAYMENTS_API.md)
- [Stripe Webhook Documentation](https://stripe.com/docs/webhooks)
- [Stripe CLI Documentation](https://stripe.com/docs/stripe-cli)

## Support

For webhook-related issues:
1. Check Stripe Dashboard → Webhooks → Event logs
2. Review server logs for error messages
3. Verify webhook secret is correctly configured
4. Test with Stripe CLI to isolate issues
