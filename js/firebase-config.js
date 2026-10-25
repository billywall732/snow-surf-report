// Firebase settings for "Sign in with Google" and saving alert preferences.
// Paste the values from Firebase console -> Project settings -> Your apps -> Web app.
// (These are NOT secrets: every web app that uses Firebase ships them to the
// browser. What protects people's data is firestore.rules, which only lets each
// signed-in person read and write their own record.)
//
// While apiKey is empty, the app shows email alerts as "not set up yet" and
// everything else works normally.
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  appId: '',
};
