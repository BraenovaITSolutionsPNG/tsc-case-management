// Firebase Cloud Functions Implementation
// Compatible with Firebase Functions v7/v8 and Admin SDK v14+

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

/**
 * Initialize Firebase Admin
 */
admin.initializeApp();

/**
 * Helper to access Realtime Database
 */
const realtimeDb = admin.database();

/**
 * Update dashboard snapshot in Firebase Realtime Database
 * Computes aggregated metrics from Supabase cases
 */
async function updateDashboardSnapshot() {
  try {
    const casesSnapshot = await admin.firestore().collection('cases').get();
    const cases = [];
    
    casesSnapshot.forEach(doc => {
      const data = doc.data();
      cases.push({
        id: data.id,
        caseNumber: data.caseNumber,
        teacherName: data.teacherName,
        province: data.province,
        matterType: data.matterType,
        status: data.status,
        assignedOfficerName: data.assignedOfficerName,
        dueDate: data.dueDate,
        actionRequired: data.actionRequired,
        escalationLevel: data.escalationLevel,
        updatedAt: data.updatedAt,
      });
    });
    
    const openCases = cases.filter(c => ['NEW', 'ASS', 'LEG', 'REF', 'ESC'].includes(c.status));
    const overdueCases = openCases.filter(c => 
      c.dueDate && new Date(c.dueDate) < new Date() && !['RES', 'CLS'].includes(c.status)
    );
    const directorDeskCases = openCases.filter(c => 
      c.escalationLevel >= 2 || (c.decisionRequired && c.status === 'DEC')
    );
    
    await realtimeDb.ref('dashboard/snapshot').set({
      timestamp: new Date().toISOString(),
      totalCases: cases.length,
      openCases: openCases.length,
      overdueCases: overdueCases.length,
      directorDeskCases: directorDeskCases.length,
      recentCases: cases.slice(0, 10).map(c => ({
        id: c.id,
        caseNumber: c.caseNumber,
        teacherName: c.teacherName,
        province: c.province,
        matterType: c.matterType,
        status: c.status,
        assignedOfficerName: c.assignedOfficerName,
        dueDate: c.dueDate,
      })),
    });
    
    console.log('Dashboard snapshot updated');
  } catch (error) {
    console.error('Error updating dashboard:', error);
    throw error;
  }
}

/**
 * Cloud Function: Sync case creation from Supabase to Firebase
 */
export const syncCaseCreation = functions.firestore
  .document('cases/{caseId}')
  .onCreate(async (snapshot, context) => {
    try {
      const newData = snapshot.data();
      if (!newData) return null;
      
      await realtimeDb.ref(`cases/${newData.id}`).set({
        id: newData.id,
        caseNumber: newData.caseNumber,
        teacherName: newData.teacherName,
        province: newData.province,
        matterType: newData.matterType,
        status: newData.status,
        assignedOfficerName: newData.assignedOfficerName,
        dueDate: newData.dueDate,
        actionRequired: newData.actionRequired,
        escalationLevel: newData.escalationLevel,
        updatedAt: newData.updatedAt,
        eventCount: newData.eventCount || 0,
        hasBrief: !!newData.briefIssue,
        decisionRequired: newData.decisionRequired || false,
      });
      
      await updateDashboardSnapshot();
      return { success: true };
    } catch (error) {
      console.error('syncCaseCreation error:', error);
      return { success: false, error: String(error) };
    }
  });

/**
 * Cloud Function: Sync case updates from Supabase to Firebase
 */
export const syncCaseUpdate = functions.firestore
  .document('cases/{caseId}')
  .onUpdate(async (snapshot, context) => {
    try {
      const newData = snapshot.after.data();
      if (!newData) return null;
      
      await realtimeDb.ref(`cases/${newData.id}`).update({
        id: newData.id,
        caseNumber: newData.caseNumber,
        teacherName: newData.teacherName,
        province: newData.province,
        matterType: newData.matterType,
        status: newData.status,
        assignedOfficerName: newData.assignedOfficerName,
        dueDate: newData.dueDate,
        actionRequired: newData.actionRequired,
        escalationLevel: newData.escalationLevel,
        updatedAt: newData.updatedAt,
      });
      
      return { success: true };
    } catch (error) {
      console.error('syncCaseUpdate error:', error);
      return { success: false, error: String(error) };
    }
  });

/**
 * Cloud Function: Sync case events from Supabase to Firebase
 */
export const syncCaseEvent = functions.firestore
  .document('caseEvents/{eventId}')
  .onCreate(async (snapshot, context) => {
    try {
      const data = snapshot.data();
      if (!data) return null;
      
      await realtimeDb.ref(`events/${data.id}`).set({
        id: data.id,
        caseId: data.caseId,
        eventType: data.eventType,
        note: data.note,
        actorId: data.actorId,
        actorName: data.actorName,
        createdAt: data.createdAt,
      });
      
      return { success: true };
    } catch (error) {
      console.error('syncCaseEvent error:', error);
      return { success: false, error: String(error) };
    }
  });

/**
 * Scheduled Cloud Function: Update dashboard every minute
 */
export const updateDashboard = functions.pubsub
  .schedule('every 1 minutes')
  .onRun(async (context) => {
    try {
      await updateDashboardSnapshot();
      return { success: true };
    } catch (error) {
      console.error('updateDashboard error:', error);
      return { success: false, error: String(error) };
    }
  });

/**
 * HTTP Cloud Function: Health check endpoint
 */
export const healthCheck = functions.https.onRequest(async (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    message: 'Firebase real-time sync functions are running'
  });
});