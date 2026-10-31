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

// Public half of the key that signs morning phone notifications ("web push").
// The private half is the VAPID_PRIVATE_KEY secret in GitHub. Not a secret either.
export const vapidPublicKey = 'BIFwDrDylGPUqKHhaw8XHow6jkF_ymr351gBfTykGfRJtP9TzD7nEw0GKrF2EHMR4oJ99_3DtqDFYRgOZcaHKJQ';
