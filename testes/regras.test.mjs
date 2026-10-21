import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, collection, getDocs, query, where, deleteField } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-idiomex",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8089 } });
// Contas novas entram com Google; "dbSenha" simula uma conta de e-mail e senha
const db = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: "google.com" } }).firestore();
const dbSenha = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: "password" } }).firestore();
let ok = 0, bad = 0;
async function t(nome, p) { try { await p; ok++; console.log("ok  ", nome); } catch (e) { bad++; console.log("FAIL", nome, e.message.split("\n")[0]); } }

// Legacy professor P0 (no index entry yet) and seed data
await env.withSecurityRulesDisabled(async (c) => {
  const d = c.firestore();
  await setDoc(doc(d, "usuarios/P0"), { tipo: "professor", nome: "P0", email: "p0@x", codigoProfessor: "PROF-AAAA" });
  await setDoc(doc(d, "usuarios/OLD"), { tipo: "aluno", nome: "old", email: "o@x", professorId: "P0" });
});

// Professor signup via batch
const p1 = db("P1"); const b = writeBatch(p1);
b.set(doc(p1, "usuarios/P1"), { tipo: "professor", nome: "P1", email: "p1@x", codigoProfessor: "PROF-BBBB" });
b.set(doc(p1, "codigosProfessor/PROF-BBBB"), { professorId: "P1" });
await t("professor signup batch", b.commit());
// Collision: P2 tries to grab P1's code
const p2 = db("P2"); const b2 = writeBatch(p2);
b2.set(doc(p2, "usuarios/P2"), { tipo: "professor", nome: "P2", email: "p2@x", codigoProfessor: "PROF-BBBB" });
b2.set(doc(p2, "codigosProfessor/PROF-BBBB"), { professorId: "P2" });
await t("code collision rejected", assertFails(b2.commit()));
// Student cannot create a code entry
await t("student cannot claim a code", assertFails(setDoc(doc(db("S9"), "codigosProfessor/PROF-ZZZZ"), { professorId: "S9" })));
// Legacy professor migration
await t("legacy professor registers own code", setDoc(doc(db("P0"), "codigosProfessor/PROF-AAAA"), { professorId: "P0" }));
await t("cannot register someone else's code", assertFails(setDoc(doc(db("P1"), "codigosProfessor/PROF-AAAA"), { professorId: "P1" })));
// Cadastro novo com e-mail e senha não consegue criar perfil
await t("email/password account cannot create a profile", assertFails(setDoc(doc(dbSenha("E1"), "usuarios/E1"), { tipo: "aluno", nome: "e", email: "e@x" })));
const e2 = dbSenha("E2"); const be = writeBatch(e2);
be.set(doc(e2, "usuarios/E2"), { tipo: "professor", nome: "E2", email: "e2@x", codigoProfessor: "PROF-EEEE" });
be.set(doc(e2, "codigosProfessor/PROF-EEEE"), { professorId: "E2" });
await t("email/password account cannot sign up as professor", assertFails(be.commit()));
// Conta antiga de e-mail e senha (perfil já existe) continua usando o app
await t("legacy email/password student edits own profile", updateDoc(doc(dbSenha("OLD"), "usuarios/OLD"), { telefone: "11988887777" }));
await t("legacy email/password student reads own professor", getDoc(doc(dbSenha("OLD"), "usuarios/P0")));
// Lookup / list
await t("authed get code", getDoc(doc(db("S1"), "codigosProfessor/PROF-BBBB")));
await t("list codes denied", assertFails(getDocs(collection(db("S1"), "codigosProfessor"))));
await t("unauth get denied", assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "codigosProfessor/PROF-BBBB"))));
// Student signup
await t("student signup w/ valid code", setDoc(doc(db("S1"), "usuarios/S1"), { tipo: "aluno", nome: "s1", email: "s1@x", professorId: "P1", codigoVinculo: "PROF-BBBB" }));
await t("student signup w/o code denied", assertFails(setDoc(doc(db("S2"), "usuarios/S2"), { tipo: "aluno", nome: "s2", email: "s2@x", professorId: "P1" })));
await t("student signup wrong code denied", assertFails(setDoc(doc(db("S3"), "usuarios/S3"), { tipo: "aluno", nome: "s3", email: "s3@x", professorId: "P1", codigoVinculo: "PROF-AAAA" })));
// Reading professor profiles
await t("stranger cannot read professor profile", assertFails(getDoc(doc(db("S9"), "usuarios/P1"))));
await t("linked student reads professor profile", getDoc(doc(db("S1"), "usuarios/P1")));
await t("legacy student reads own professor", getDoc(doc(db("OLD"), "usuarios/P0")));
await t("professor lists own students", getDocs(query(collection(db("P1"), "usuarios"), where("tipo", "==", "aluno"), where("professorId", "==", "P1"))));
// Student profile updates
await t("student edits contact", updateDoc(doc(db("S1"), "usuarios/S1"), { telefone: "11999999999" }));
await t("legacy student edits contact", updateDoc(doc(db("OLD"), "usuarios/OLD"), { telefone: "11999999999" }));
await t("student switch w/o valid code denied", assertFails(updateDoc(doc(db("S1"), "usuarios/S1"), { professorId: "P0" })));
await t("student switches w/ valid code", updateDoc(doc(db("S1"), "usuarios/S1"), { professorId: "P0", codigoVinculo: "PROF-AAAA" }));
await t("student cannot become professor", assertFails(updateDoc(doc(db("S1"), "usuarios/S1"), { tipo: "professor" })));
// Professor removes student
await t("professor removes student", updateDoc(doc(db("P0"), "usuarios/S1"), { professorId: deleteField() }));
await t("unlinked student relinks", updateDoc(doc(db("S1"), "usuarios/S1"), { professorId: "P1", codigoVinculo: "PROF-BBBB" }));
// Messages deletion by student
await setDoc(doc(db("P1"), "usuarios/S1/mensagens/m1"), { texto: "oi" });
await t("student deletes own messages", deleteDoc(doc(db("S1"), "usuarios/S1/mensagens/m1")));
await t("student still cannot write messages", assertFails(setDoc(doc(db("S1"), "usuarios/S1/mensagens/m2"), { texto: "x" })));
// Professor deletes own code entry
await t("other cannot delete code", assertFails(deleteDoc(doc(db("P0"), "codigosProfessor/PROF-BBBB"))));
await t("owner deletes code", deleteDoc(doc(db("P1"), "codigosProfessor/PROF-BBBB")));
console.log(`\n${ok} ok, ${bad} failed`);
await env.cleanup();
process.exit(bad ? 1 : 0);
