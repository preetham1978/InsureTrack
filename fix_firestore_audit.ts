import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc } from "firebase/firestore";
import fs from "fs";

const config = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf8"));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId || "(default)");

async function fix() {
  const colRef = collection(db, "audit_log");
  const snap = await getDocs(colRef);
  for (const d of snap.docs) {
    const log = d.data();
    if (log.user_email && log.user_email.includes("medyaan.com")) {
      const newEmail = log.user_email.replace("medyaan.com", "veloai.com");
      await updateDoc(doc(db, "audit_log", d.id), { user_email: newEmail });
    }
  }
  process.exit(0);
}
fix().catch(err => {
  console.error(err);
  process.exit(1);
});
