import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc } from "firebase/firestore";
import fs from "fs";

const config = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf8"));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId || "(default)");

async function fix() {
  const usersRef = collection(db, "users");
  const snap = await getDocs(usersRef);
  for (const d of snap.docs) {
    const user = d.data();
    if (user.email && user.email.includes("medyaan.com")) {
      const newEmail = user.email.replace("medyaan.com", "veloai.com");
      await updateDoc(doc(db, "users", d.id), { email: newEmail });
      console.log(`Updated user ${d.id} to ${newEmail}`);
    }
  }
  process.exit(0);
}
fix().catch(err => {
  console.error(err);
  process.exit(1);
});
