import * as functions from 'firebase-functions';
/**
 * Cloud Function: Sync case creation from Supabase to Firebase
 */
export declare const syncCaseCreation: any;
/**
 * Cloud Function: Sync case updates from Supabase to Firebase
 */
export declare const syncCaseUpdate: any;
/**
 * Cloud Function: Sync case events from Supabase to Firebase
 */
export declare const syncCaseEvent: any;
/**
 * Scheduled Cloud Function: Update dashboard every minute
 */
export declare const updateDashboard: any;
/**
 * HTTP Cloud Function: Health check endpoint
 */
export declare const healthCheck: functions.https.HttpsFunction;
