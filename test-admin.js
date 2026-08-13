const admin = require("firebase-admin");
const fs = require("fs");
try {
  const config = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf8"));
  const app = admin.initializeApp({ projectId: config.projectId });
  const db = admin.firestore(app, config.firestoreDatabaseId);
  db.collection("test").get().then(() => console.log("SUCCESS")).catch(e => console.log("ERROR", e.message));
} catch(e) {
  console.log("INIT ERROR", e.message);
}
