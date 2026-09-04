# Razorpay Integration Setup Guide

## ✅ Status: Razorpay Integration Complete

Your Hostel360 backend is fully integrated with **Razorpay** for handling INR (Indian Rupee) subscription payments using payment links.

### Current Configuration
- **Key ID**: `rzp_test_TY5iBO5vYMtVyt` ✅
- **Key Secret**: Configured in `.env` ✅
- **SDK**: `razorpay==2.0.1` in requirements.txt ✅
- **Environment**: Test Mode (sandbox)

---

## 🏗️ Architecture Overview

### Payment Flow
```
Owner → Create Subscription Link → Payment Link Generated
           ↓
        Razorpay Checkout
           ↓
        Customer Pays
           ↓
        Webhook Notification → Auto-Activate Subscription
           ↓
        Hostel Gets Premium Plan Access
```

---

## 📋 Implementation Details

### 1. **Subscription Payment Link Creation**
**Endpoint**: `POST /api/payments/subscription/link`

**Location**: `server.py` lines 1195-1223

**Features**:
- Creates payment links for owners to purchase plans
- Calculates price based on hostel bed count (5 pricing slabs)
- Returns short URL for customer checkout
- Stores payment record in `rp_payments` collection

**Request**:
```bash
curl -X POST http://localhost:8000/api/payments/subscription/link \
  -H "Authorization: Bearer <owner_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "hostel_id": "hostel_id_here",
    "months": 1
  }'
```

**Response**:
```json
{
  "payment_link_id": "plink_123abc456def",
  "checkout_url": "https://rzp.io/l/xyz123",
  "amount": 299.0
}
```

---

### 2. **Payment Status Tracking**
**Endpoint**: `GET /api/payments/subscription/status/{payment_link_id}`

**Location**: `server.py` lines 1226-1244

**Features**:
- Polls Razorpay for payment status
- Auto-activates subscription on payment confirmation
- Updates hostel's `premium_plan` and `plan_expiry` fields
- Prevents duplicate activation

**Response**:
```json
{
  "status": "paid",
  "activated": true,
  "months": 1
}
```

---

### 3. **Webhook Handler**
**Endpoint**: `POST /api/razorpay/webhook`

**Location**: `server.py` lines 1254-1277

**Features**:
- Receives `payment_link.paid` events from Razorpay
- Verifies webhook signature using `RAZORPAY_WEBHOOK_SECRET`
- Automatically activates subscription
- Creates subscription record in database

**Event Type**: `payment_link.paid`

---

### 4. **Callback Handler**
**Endpoint**: `GET /api/razorpay/callback`

**Location**: `server.py` lines 1247-1251

**Features**:
- Customer redirect URL after payment
- Shows success/cancellation message

---

## 💰 Pricing Slabs (INR - Rupees)

Based on number of beds in hostel:

| Bed Range | Plan Label | 1 Month | 3 Months | 6 Months | 12 Months |
|-----------|-----------|---------|----------|----------|-----------|
| 1-40 | Up to 40 beds | ₹299 | ₹799 | ₹1,499 | ₹2,499 |
| 41-70 | 41-70 beds | ₹499 | ₹1,299 | ₹2,499 | ₹4,499 |
| 71-100 | 71-100 beds | ₹699 | ₹1,899 | ₹3,699 | ₹6,999 |
| 101-130 | 101-130 beds | ₹999 | ₹2,699 | ₹5,199 | ₹9,999 |
| 131+ | 131+ beds | ₹1,499 | ₹3,999 | ₹7,999 | ₹14,999 |

**Code Location**: `server.py` lines 40-48

---

## 🔧 Configuration Steps

### Step 1: Environment Variables
Your `.env` file is already configured with:
```env
RAZORPAY_KEY_ID=rzp_test_TY5iBO5vYMtVyt
RAZORPAY_KEY_SECRET=Y8r9260ZlRKTwIdYdYt5gzyc
RAZORPAY_WEBHOOK_SECRET=whsec_xxxx_xxxxxxxx
EXPO_PUBLIC_BACKEND_URL=http://localhost:8000
```

### Step 2: Webhook Setup (IMPORTANT!)
1. Go to [Razorpay Dashboard](https://dashboard.razorpay.com/)
2. Navigate to **Settings → Webhooks**
3. Click **Add New Webhook**
4. Enter these details:
   - **Webhook URL**: `https://your-domain.com/api/razorpay/webhook`
   - **Events to listen to**: Check `payment_link.paid`
   - **Active**: ✅ Enable
5. Copy the **Webhook Secret** (whsec_xxx)
6. Update `.env`:
   ```env
   RAZORPAY_WEBHOOK_SECRET=whsec_xxxx_xxxxxxxx
   ```

### Step 3: Install Dependencies
```bash
pip install -r requirements.txt
```
Razorpay SDK (v2.0.1) is already included.

### Step 4: Start Backend Server
```bash
cd backend
python -m uvicorn server:app --reload
```

---

## 🧪 Testing in Sandbox Mode

### Test Payment Link Creation
```bash
# 1. Login as owner first
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "owner@hostel360.com",
    "password": "Owner@12345"
  }'

# Save the access_token from response

# 2. Create payment link
curl -X POST http://localhost:8000/api/payments/subscription/link \
  -H "Authorization: Bearer <access_token_here>" \
  -H "Content-Type: application/json" \
  -d '{
    "hostel_id": "<hostel_id_here>",
    "months": 1
  }'
```

### Test Payment
1. Copy the `checkout_url` from response
2. Open in browser
3. Use Razorpay test card: **4111 1111 1111 1111**
4. Any future expiry date (e.g., 12/25)
5. Any 3-digit CVV (e.g., 123)
6. Complete payment

### Expected Results
- ✅ Payment link shows `status: "paid"`
- ✅ Subscription activates automatically
- ✅ Hostel's `premium_plan` updated in database
- ✅ `plan_expiry` date calculated based on months

---

## 🗄️ Database Schema

### `rp_payments` Collection
Stores Razorpay payment records:
```json
{
  "_id": ObjectId,
  "id": "unique_id_here",
  "payment_link_id": "plink_xxx",
  "reference_id": "sub_hostel123_timestamp",
  "hostel_id": "hostel_id_here",
  "owner_id": "owner_id_here",
  "months": 1,
  "amount": 299,
  "amount_paise": 29900,
  "status": "created|paid",
  "activated": false,
  "created_at": "2024-01-15T10:30:00Z",
  "paid_at": "2024-01-15T10:35:00Z"
}
```

### `subscriptions` Collection
Stores active subscription records:
```json
{
  "_id": ObjectId,
  "id": "unique_id_here",
  "owner_id": "owner_id_here",
  "hostel_id": "hostel_id_here",
  "plan_name": "Monthly Plan|3-Month Plan|6-Month Plan|12-Month Plan",
  "months": 1,
  "amount": 299,
  "method": "razorpay|manual|stripe",
  "invoice_no": "INV-240115-ABC123",
  "status": "active|expired",
  "start": "2024-01-15T10:30:00Z",
  "end": "2024-02-15T10:30:00Z",
  "created_at": "2024-01-15T10:30:00Z"
}
```

### Hostel Collection Updates
When subscription activates:
```json
{
  "premium_plan": "Monthly Plan",
  "plan_expiry": "2024-02-15T10:30:00Z"
}
```

---

## 🔐 Security Best Practices

### 1. Webhook Signature Verification
✅ Already implemented in `server.py` (lines 1260-1262):
```python
expected = hmac.new(RAZORPAY_WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
if not hmac.compare_digest(expected, sig):
    raise HTTPException(400, "Invalid webhook signature")
```

### 2. Environment Variables
- Never commit `.env` to git
- Use `.env.example` for team reference
- Rotate API keys periodically
- Use separate test/production credentials

### 3. Payment Validation
- Verify payment through both webhook AND status endpoint
- Check payment amount matches expected price
- Prevent duplicate subscriptions with `activated` flag

---

## 🚀 Production Migration

### Switch from Sandbox to Live

#### Step 1: Generate Live API Keys
1. Go to [Razorpay Dashboard](https://dashboard.razorpay.com/)
2. Click **Settings** → **API Keys**
3. Click toggle to switch to **Live Mode**
4. Copy live credentials

#### Step 2: Update Environment
```env
# OLD (sandbox)
RAZORPAY_KEY_ID=rzp_test_TY5iBO5vYMtVyt
RAZORPAY_KEY_SECRET=Y8r9260ZlRKTwIdYdYt5gzyc

# NEW (production)
RAZORPAY_KEY_ID=rzp_live_xxxxx
RAZORPAY_KEY_SECRET=your_live_secret_here
```

#### Step 3: Update Webhook URL
1. In Razorpay Dashboard, go to **Settings** → **Webhooks**
2. Update webhook URL to production domain:
   ```
   https://hostel360.com/api/razorpay/webhook
   ```
3. Update webhook secret if needed
4. Re-generate and copy new `RAZORPAY_WEBHOOK_SECRET`

#### Step 4: Update Backend Configuration
```env
EXPO_PUBLIC_BACKEND_URL=https://hostel360.com
```

#### Step 5: Deploy & Test
1. Deploy backend to production
2. Test with real payment (use small amount)
3. Verify webhook fires correctly
4. Monitor logs for any errors

---

## 🐛 Troubleshooting

### Issue: Payment Link Not Creating
**Solutions**:
- ✅ Check `RAZORPAY_KEY_ID` starts with `rzp_test_` or `rzp_live_`
- ✅ Verify `RAZORPAY_KEY_SECRET` is correct (no spaces)
- ✅ Ensure owner account exists and is not blocked
- ✅ Verify hostel has at least 1 bed
- ✅ Check server logs: `docker logs backend` or console output

**Test**:
```bash
curl -X POST http://localhost:8000/api/payments/subscription/link \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"hostel_id": "test", "months": 1}' -v
```

---

### Issue: Webhook Not Triggering
**Solutions**:
- ✅ Verify webhook URL is publicly accessible (not localhost)
- ✅ Use ngrok for local testing: `ngrok http 8000`
- ✅ Update Razorpay webhook URL to ngrok URL
- ✅ Check webhook is enabled in Razorpay Dashboard
- ✅ Verify `RAZORPAY_WEBHOOK_SECRET` matches dashboard value
- ✅ Check server logs for signature verification errors

**Test Webhook Locally**:
```bash
# Terminal 1: Start ngrok
ngrok http 8000

# Terminal 2: Update webhook in Razorpay to https://xxxxx.ngrok.io/api/razorpay/webhook

# Terminal 3: Create payment and complete it
```

---

### Issue: Payment Shows Paid But Subscription Not Activated
**Solutions**:
- ✅ Check if `activated` flag is true in `rp_payments` record
- ✅ Verify `plan_expiry` is updated in hostel record
- ✅ Check server logs for `_activate_subscription()` errors
- ✅ Ensure database connection is working
- ✅ Check if owner has permission to activate

**Debug**:
```bash
# Check payment record
db.rp_payments.findOne({"payment_link_id": "plink_xxx"})

# Check hostel subscription status
db.hostels.findOne({"id": "hostel_xxx"}, {"premium_plan": 1, "plan_expiry": 1})
```

---

### Issue: 401 Unauthorized on Payment Link Creation
**Solutions**:
- ✅ Verify token is valid (not expired)
- ✅ Check Authorization header format: `Bearer <token>`
- ✅ Ensure user is logged in as owner role
- ✅ Verify user account is not blocked

**Test**:
```bash
# 1. Get fresh token
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "owner@hostel360.com", "password": "Owner@12345"}'

# 2. Use token immediately in next request
```

---

## 📊 Monitoring & Analytics

### Check Payment History
```bash
# View all payments for a hostel
db.subscriptions.find({"hostel_id": "hostel_xxx"}).pretty()

# View all Razorpay payments
db.rp_payments.find({}).pretty()

# Revenue calculation
db.subscriptions.aggregate([
  {"$match": {"status": "active"}},
  {"$group": {"_id": null, "total": {"$sum": "$amount"}}}
])
```

### Key Metrics
- Total revenue: Sum of all paid subscriptions
- Active subscriptions: Count where `status: "active"`
- Trial users: Count where `plan_expiry` > now
- Churn rate: Expired subscriptions not renewed

---

## 🔗 Useful Resources

- [Razorpay Documentation](https://razorpay.com/docs/)
- [Payment Links API](https://razorpay.com/docs/api/payment-links/)
- [Webhook Events](https://razorpay.com/docs/webhooks/events/)
- [Test Cards](https://razorpay.com/docs/payments/payments/test-cards/)
- [Python SDK](https://github.com/razorpay/razorpay-python)

---

## 📞 Support

**For Razorpay Issues**:
- Contact: [Razorpay Support](https://razorpay.com/support/)
- Email: support@razorpay.com
- Dashboard: [Razorpay Dashboard](https://dashboard.razorpay.com)

**For Backend Issues**:
- Check server logs
- Verify environment variables
- Review webhook delivery in Razorpay Dashboard
- Check database collections for records

---

## ✨ Next Steps

1. ✅ **Verify Webhook Secret**
   - Get `RAZORPAY_WEBHOOK_SECRET` from Razorpay Dashboard
   - Update `.env` file

2. ✅ **Test End-to-End**
   - Create payment link via API
   - Complete test payment
   - Verify subscription activation

3. ✅ **Update Frontend**
   - Add payment link button to subscription screen
   - Show checkout URL in modal or redirect
   - Display subscription status with countdown

4. ✅ **Setup Monitoring**
   - Monitor webhook deliveries
   - Track payment success rate
   - Alert on failed payments

5. ✅ **Production Deployment**
   - Switch to live API keys
   - Update webhook URL
   - Test with real payment
   - Monitor closely first week
