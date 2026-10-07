# Firebase Real-Time Sync Functions

This directory contains cloud functions that sync data changes from Supabase to Firebase Realtime Database, enabling real-time updates in the Next.js case management application.

## What This Does

These functions provide:

✅ **Real-time Dashboard Updates** - Live counts and metrics without page refreshes
✅ **Instant Case Status Changes** - Real-time visibility into case status updates
✅ **Push Notifications** - New case events appear instantly
✅ **Fallback to Supabase** - Existing Supabase logic remains as source of truth
✅ **Health Monitoring** - Built-in health check endpoint

## Setup Instructions

### 1. Deploy Functions
```bash
# Navigate to functions directory
firebase-functions/
cd firebase-functions

# Deploy to production
firebase deploy --only functions
```

### 2. Local Testing
```bash
# Test functions locally
firebase emulators:start --only functions

# Or run health check
curl https://your-region-your-project.cloudfunctions.net/healthCheck
```

## Functions Provided

### syncCaseCreation
- **Trigger**: When a new case is created in Supabase
- **Action**: Syncs case data to Firebase Realtime Database
- **Effect**: Enables real-time case addition visibility

### syncCaseUpdate  
- **Trigger**: When an existing case is updated in Supabase
- **Action**: Updates Firebase Realtime Database
- **Effect**: Enables real-time case status changes

### syncCaseEvent
- **Trigger**: When a case event is created in Supabase
- **Action**: Stores events in Firebase Realtime Database
- **Effect**: Enables real-time activity feed updates

### updateDashboard (Scheduled)
- **Trigger**: Every minute
- **Action**: Computes and updates dashboard aggregates in Firebase
- **Effect**: Ensures dashboard data is always current

### healthCheck
- **Trigger**: HTTP request
- **Action**: Returns function health status
- **Effect**: Allows monitoring of function status

## Integration

The Next.js application reads from Firebase Realtime Database for real-time updates:

1. **Dashboard Component** - Subscribes to Firebase for live metrics
2. **Case Events** - Subscribes to Firebase for activity feed
3. **Fallback Mechanism** - Falls back to Supabase if Firebase unavailable

## Environment Variables

### Required for Cloud Functions
```bash
# Set in Firebase Console → Project Settings → Service Accounts
# Download service account key JSON
# Configure in deployment environment
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=your-private-key
```

### Client-Side (Next.js)
```bash
# In .env.local or deployment environment
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
```

## Architecture

### Supabase (Source of Truth)
- Authentication and user management
- Primary database with Drizzle ORM
- File storage (Supabase Storage)

### Firebase (Real-time Layer)
- Realtime Database for live updates
- Cloud Functions for data sync
- Health monitoring and diagnostics

### Next.js (Frontend)
- React components with real-time subscriptions
- TRPC for API communication
- Firebase integration for live updates

## Benefits

1. **Real-time Experience** - No more page refreshes for data updates
2. **Reduced Server Load** - Lighter client queries with Firebase caching
3. **Better Performance** - Immediate visibility into system changes
4. **Enhanced User Experience** - Officers see updates instantly
5. **Reliable Architecture** - Clear separation of concerns

## Monitoring

Monitor function health:
```bash
# Check function status
curl https://your-region-your-project.cloudfunctions.net/healthCheck

# View logs in Firebase Console
Build → Cloud Functions → select function → Logs
```

## Troubleshooting

### Common Issues

1. **Functions Not Deploying**
   - Verify all dependencies are installed
   - Check Firebase authentication
   - Ensure correct project ID

2. **Real-time Updates Not Working**
   - Verify Firebase configuration in Next.js
   - Check internet connection
   - Restart affected components

3. **Dashboard Stale Data**
   - Wait for scheduled function to run
   - Check function logs for errors
   - Manually trigger dashboard update if needed

## Maintenance

### Regularly Monitor
- Function execution logs
- Database connection health
- API response times
- Error rates

### Updates
- Update function code as needed
- Monitor for breaking changes in Firebase SDKs
- Test deployments in staging before production

## Support

For issues or questions:
1. Check function logs in Firebase Console
2. Verify environment variables
3. Test health endpoint manually
4. Review deployment configuration

## Getting Started

1. Deploy the cloud functions
2. Configure Firebase in Next.js
3. Update dashboard components to use Firebase
4. Test real-time functionality
5. Monitor and optimize

This setup provides a solid foundation for real-time case management while maintaining Supabase as the reliable source of truth for all data operations.