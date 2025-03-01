# PIN Management Implementation Guide

This document explains how to implement the enhanced PIN management system that integrates with your existing authentication and user management infrastructure.

## Table of Contents
1. [User Model Updates](#user-model-updates)
2. [Route Setup](#route-setup)
3. [Implementation Steps](#implementation-steps)
4. [Security Considerations](#security-considerations)
5. [Testing Plan](#testing-plan)

## User Model Updates

Add these fields to your user model schema to support enhanced PIN management:

```javascript
// Add to your existing User schema
const userSchema = new mongoose.Schema({
  // ... existing fields

  // PIN management fields
  pin: {
    type: String,
    required: true,
    select: false, // Don't include in regular queries
  },
  pinResetToken: {
    type: String,
    select: false
  },
  pinResetExpiry: {
    type: Date,
    select: false
  },
  forcePinChange: {
    type: Boolean,
    default: false
  },
  pinLastChanged: {
    type: Date,
    default: Date.now
  },
  pinHistory: {
    type: [String], // Stores hashed PINs
    select: false,
    validate: [
      function(val) {
        return val.length <= 5;
      },
      '{PATH} exceeds the limit of 5'
    ]
  },
  pinRetryCount: {
    type: Number,
    default: 0
  },
  pinLockedUntil: {
    type: Date,
    default: null
  },
  
  // ... other fields
});
```

Add these methods to your User model:

```javascript
// Check if PIN is locked
userSchema.methods.isPinLocked = function() {
  return this.pinLockedUntil && this.pinLockedUntil > new Date();
};

// Record PIN verification attempt
userSchema.methods.recordPinAttempt = async function(isSuccess) {
  if (isSuccess) {
    // Reset counter on successful attempt
    this.pinRetryCount = 0;
    this.pinLockedUntil = null;
  } else {
    // Increment counter on failed attempt
    this.pinRetryCount += 1;
    
    // Lock PIN after 5 failed attempts
    if (this.pinRetryCount >= 5) {
      // Lock for 30 minutes
      this.pinLockedUntil = new Date(Date.now() + 30 * 60 * 1000);
      this.pinRetryCount = 0;
    }
  }
  
  await this.save();
  return !this.isPinLocked();
};

// Check if PIN has been used before
userSchema.methods.isPinReused = async function(rawPin) {
  // Skip check if history is empty
  if (!this.pinHistory || this.pinHistory.length === 0) {
    return false;
  }
  
  // Check against history
  for (const hashedPin of this.pinHistory) {
    if (await bcrypt.compare(rawPin, hashedPin)) {
      return true;
    }
  }
  
  return false;
};

// Update PIN with history tracking
userSchema.methods.updatePin = async function(newPin) {
  // Add current PIN to history if it exists
  if (this.pin) {
    this.pinHistory = this.pinHistory || [];
    
    // Add current PIN to history
    this.pinHistory.push(this.pin);
    
    // Keep only the last 5
    if (this.pinHistory.length > 5) {
      this.pinHistory.shift();
    }
  }
  
  // Hash and set new PIN
  const hashedPin = await bcrypt.hash(newPin, 10);
  this.pin = hashedPin;
  
  // Update last changed timestamp
  this.pinLastChanged = new Date();
  
  // Clear force change flag
  this.forcePinChange = false;
  
  return this.save();
};
```

## Route Setup

### 1. Create routes file:

```javascript
// routes/pinRoutes.js
const express = require('express');
const router = express.Router();
const pinController = require('../controllers/pinController');
const { auth, hasRole, verifyPasscodeAndAuth } = require('../middlewares/auth');
const { verifyPin } = require('../middlewares/pinVerification');

// User PIN routes (require authentication)
router.post('/update', auth, verifyPin, pinController.updatePin);
router.post('/reset-request', auth, pinController.requestPinReset);
router.post('/verify-reset', auth, pinController.verifyPinReset);

// Admin PIN routes (require admin role)
router.post('/admin/reset/:userId', auth, hasRole('admin'), pinController.adminResetPin);
router.post('/admin/set/:userId', auth, hasRole('admin'), pinController.adminSetPin);

module.exports = router;
```

### 2. Register routes in your main app file:

```javascript
// In your main app.js or index.js
const pinRoutes = require('./routes/pinRoutes');

// Register routes
app.use('/api/pin', pinRoutes);
```

## Implementation Steps

### 1. Create PIN Verification Middleware

Save the provided `pinVerification.js` middleware file in your middleware directory.

### 2. Implement PIN Controller

Save the provided `pinController.js` file in your controllers directory.

### 3. Update Email Service

Update your existing email service with the enhanced version that includes PIN reset templates.

### 4. Create Admin Action Log Model

Create the Admin Action Log model to track all administrative PIN actions.

### 5. Update User Routes to Check for Forced PIN Change

Add middleware to your main app routes to check for forced PIN changes:

```javascript
// In app.js or your main routes file
const { checkPinChangeRequired } = require('./middlewares/pinVerification');

// Apply middleware to routes that require PIN security
app.use('/api/accounts', auth, checkPinChangeRequired, accountRoutes);
app.use('/api/transactions', auth, checkPinChangeRequired, transactionRoutes);
```

## Security Considerations

1. **PIN Storage**: PINs should never be stored in plain text. Always hash PINs using bcrypt.

2. **Rate Limiting**: Implement rate limiting on PIN-related endpoints to prevent brute force attacks.

3. **PIN Complexity**: Enforce PIN complexity rules (4-digit numeric only is standard for banking).

4. **Session Handling**: Clear sessions when changing critical security credentials like PINs.

5. **Audit Logging**: Log all PIN-related events for security auditing.

6. **PIN History**: Prevent reuse of previous PINs (we store the last 5).

7. **PIN Lockout**: Implement progressive lockout after failed attempts (5 attempts in our implementation).

8. **Secure Communications**: Always use HTTPS for PIN-related operations.

9. **Email Security**: Ensure emails with PIN reset instructions are secure and don't contain actual PINs.

## Testing Plan

1. **Unit Tests**:
   - Test PIN validation logic
   - Test PIN history tracking
   - Test PIN lockout mechanism

2. **Integration Tests**:
   - Test PIN update flow
   - Test PIN reset flow
   - Test admin PIN management

3. **Security Tests**:
   - Test PIN brute force protection
   - Test PIN history enforcement
   - Test forced PIN change functionality

4. **User Flow Tests**:
   - Test entire PIN reset user experience
   - Test admin-initiated PIN reset flow
   - Test PIN lockout user experience